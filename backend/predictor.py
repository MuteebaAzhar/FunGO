# predictor.py
"""
FunGO — Prediction Engine
===========================
Loads XGBoost models once at startup.
Runs inference across all 3 ontologies (MFO, BPO, CCO).

Changes from original:
  1. Added get_model_stats() — returns classifier counts per ontology
     (used by /model/info endpoint).
  2. Fixed open() to use context managers (file handles now closed).
  3. tempfile.mktemp() replaced with NamedTemporaryFile (WSL fix).
  4. Failed classifiers are counted and logged instead of silent pass.
  5. Input shape validation in predict().
"""

import json
import logging
import pickle
import shutil
import subprocess
import tempfile
import numpy as np
from pathlib import Path

from config import PKL_DIR, VOCAB_PKL, IA_PKL, FEAT_META

logger = logging.getLogger(__name__)
ONTS   = ["MFO", "BPO", "CCO"]

# ── Globals ───────────────────────────────────────────────────
_models_dict     = None
_thresholds_dict = None
_ia_weights      = None
_vocabularies    = None
_top50_taxa      = None


# ── Helpers ───────────────────────────────────────────────────

def _wsl_copy(src: Path) -> Path:
    """Copy file to temp path (WSL mounted-drive permission workaround)."""
    with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    shutil.copy2(str(src), str(tmp_path))
    return tmp_path


def _safe_load(path: Path) -> object:
    """Load pickle with WSL permission workaround if needed."""
    try:
        subprocess.run(["chmod", "644", str(path)], check=False, capture_output=True)
    except Exception:
        pass
    try:
        with open(path, "rb") as fh:
            return pickle.load(fh)
    except PermissionError:
        pass
    tmp_path = None
    try:
        tmp_path = _wsl_copy(path)
        with open(tmp_path, "rb") as fh:
            return pickle.load(fh)
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()


def _safe_read_json(path: Path) -> dict:
    """Read JSON with WSL permission workaround."""
    try:
        subprocess.run(["chmod", "644", str(path)], check=False, capture_output=True)
    except Exception:
        pass
    for mode in ("r", "rb"):
        try:
            with open(path, mode) as fh:
                raw = fh.read()
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                return json.loads(raw)
        except PermissionError:
            continue
    result = subprocess.run(["cat", str(path)], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


# ── Public API ────────────────────────────────────────────────

def load_all():
    """
    Load all models and supporting data into memory.
    Call once at Flask startup (~30–120 s depending on hardware).
    """
    global _models_dict, _thresholds_dict, _ia_weights, _vocabularies, _top50_taxa

    logger.info("[predictor] Loading vocabularies …")
    _vocabularies = _safe_load(VOCAB_PKL)

    logger.info("[predictor] Loading IA weights …")
    _ia_weights = _safe_load(IA_PKL)
    logger.info("[predictor] IA weights: %d terms", len(_ia_weights))

    meta        = _safe_read_json(FEAT_META)
    _top50_taxa = [int(t) for t in meta["taxonomy_info"]["top50_taxa"]]
    logger.info("[predictor] Top-50 taxa loaded (%d)", len(_top50_taxa))

    _models_dict     = {}
    _thresholds_dict = {}

    for ont in ONTS:
        pkl_path = PKL_DIR / f"models_{ont}.pkl"
        size_mb  = pkl_path.stat().st_size / 1e6
        logger.info("[predictor] Loading %s (%.0f MB) …", pkl_path.name, size_mb)

        raw       = _safe_load(pkl_path)
        first_key = next(iter(raw))

        if first_key.startswith("GO:"):
            models_d     = raw
            thresholds_d = {t: 0.5 for t in raw}
        else:
            clf_list  = raw["models"]
            term_list = raw["selected_terms"]
            thr_raw   = raw.get("thresholds", [0.5] * len(clf_list))
            thr_list  = (list(thr_raw) if not isinstance(thr_raw, dict)
                         else [thr_raw.get(t, 0.5) for t in term_list])
            models_d     = dict(zip(term_list, clf_list))
            thresholds_d = dict(zip(term_list, thr_list))

        _models_dict[ont]     = models_d
        _thresholds_dict[ont] = thresholds_d
        logger.info("[predictor] %s: %d classifiers ready", ont, len(models_d))

    logger.info("[predictor] All models loaded successfully.")


def get_top50_taxa() -> list:
    if _top50_taxa is None:
        raise RuntimeError("Models not loaded — call load_all() first.")
    return _top50_taxa


def get_ia_weights() -> dict:
    if _ia_weights is None:
        raise RuntimeError("Models not loaded — call load_all() first.")
    return _ia_weights


def get_model_stats() -> dict:
    """
    Return classifier counts per ontology.
    Used by GET /model/info endpoint.
    Returns: {"MFO": 1500, "BPO": 1500, "CCO": 1133}
    """
    if _models_dict is None:
        raise RuntimeError("Models not loaded — call load_all() first.")
    return {ont: len(models) for ont, models in _models_dict.items()}


def predict(X_final: np.ndarray, protein_ids: list) -> list:
    """
    Run inference for all proteins across all 3 ontologies.

    Parameters
    ----------
    X_final     : (N, 15411) float32 feature matrix
    protein_ids : list of N protein ID strings

    Returns
    -------
    List of raw prediction dicts:
        [{protein_id, go_term, ontology, confidence, threshold}, …]
    """
    if _models_dict is None:
        raise RuntimeError("Models not loaded — call load_all() first.")

    N = X_final.shape[0]
    if N != len(protein_ids):
        raise ValueError(
            f"X_final has {N} rows but protein_ids has {len(protein_ids)} entries."
        )

    all_preds    = []
    failed_terms = 0

    for ont in ONTS:
        ont_models     = _models_dict[ont]
        ont_thresholds = _thresholds_dict[ont]
        n_terms        = len(ont_models)
        logger.info("[predictor] %s — scoring %d terms × %d proteins …", ont, n_terms, N)

        for go_term, clf in ont_models.items():
            threshold = float(ont_thresholds.get(go_term, 0.5))
            try:
                proba = clf.predict_proba(X_final)[:, 1]
                for i, pid in enumerate(protein_ids):
                    conf = float(proba[i])
                    if conf >= threshold:
                        all_preds.append({
                            "protein_id": pid,
                            "go_term":    go_term,
                            "ontology":   ont,
                            "confidence": round(conf, 4),
                            "threshold":  round(threshold, 4),
                        })
            except Exception as exc:
                failed_terms += 1
                logger.warning("[predictor] Classifier failed %s/%s: %s", ont, go_term, exc)

    if failed_terms:
        logger.warning("[predictor] Total failed classifiers: %d", failed_terms)

    logger.info("[predictor] Inference complete — %d raw predictions", len(all_preds))
    return all_preds
