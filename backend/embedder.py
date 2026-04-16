# embedder.py
"""
FunGO — ESM2 Embedding Extractor
==================================
Extracts layers 30–35 from ESM2-t36-3B.
- Auto-detects CPU vs GPU
- Caches embeddings per session to avoid re-extraction
- Lazy model loading (loaded only on first request)
"""

import os
import hashlib
import numpy as np
import torch
from pathlib import Path
from config import (
    MODEL_CACHE_DIR, MODEL_NAME, LAYERS_TO_USE,
    MAX_SEQ_LENGTH, BATCH_SIZE, DEVICE, USE_FP16,
    EMB_CACHE_DIR,
)

os.environ["TRANSFORMERS_OFFLINE"]  = "1"
os.environ["HF_DATASETS_OFFLINE"]   = "1"
os.environ["TRANSFORMERS_CACHE"]    = str(MODEL_CACHE_DIR)
os.environ["HF_HOME"]               = str(MODEL_CACHE_DIR)

N_ESM_DIMS = len(LAYERS_TO_USE) * 2560   # 6 × 2560 = 15,360

# ── Lazy globals ──────────────────────────────────────────────────────────
_tokenizer = None
_model     = None


def _load_model():
    """Load ESM2 tokenizer and model (only once)."""
    global _tokenizer, _model

    if _tokenizer is not None and _model is not None:
        return _tokenizer, _model

    print(f"[embedder] Loading ESM2 from local cache → {MODEL_CACHE_DIR}")
    print(f"[embedder] Device: {DEVICE}  |  FP16: {USE_FP16}")

    from transformers import EsmTokenizer, EsmModel

    _tokenizer = EsmTokenizer.from_pretrained(
        MODEL_NAME,
        cache_dir=MODEL_CACHE_DIR,
        local_files_only=True,
    )
    _model = EsmModel.from_pretrained(
        MODEL_NAME,
        cache_dir=MODEL_CACHE_DIR,
        output_hidden_states=True,
        local_files_only=True,
    )

    if USE_FP16:
        _model = _model.to(DEVICE).half()
    else:
        _model = _model.to(DEVICE)

    _model.eval()
    for p in _model.parameters():
        p.requires_grad = False

    print(f"[embedder] Model ready on {DEVICE}")
    return _tokenizer, _model


def _seq_cache_key(sequences: list) -> str:
    """Hash sequences to use as cache filename."""
    joined = "|".join(f"{s[:50]}{len(s)}" for s in sequences)
    return hashlib.md5(joined.encode()).hexdigest()[:16]


def _load_cache(key: str):
    path = EMB_CACHE_DIR / f"{key}.npy"
    if path.exists():
        return np.load(str(path))
    return None


def _save_cache(key: str, arr: np.ndarray):
    np.save(str(EMB_CACHE_DIR / f"{key}.npy"), arr)


def extract(sequences: list) -> np.ndarray:
    """
    Extract ESM2 embeddings for a list of sequences.
    Returns np.ndarray of shape (N, 15360), dtype float32.
    Sequences are truncated to MAX_SEQ_LENGTH if needed.
    Uses cache to avoid re-extraction.
    """
    # Truncate sequences
    seqs_truncated = [s[:MAX_SEQ_LENGTH] for s in sequences]
    N = len(seqs_truncated)

    # Check cache
    cache_key  = _seq_cache_key(seqs_truncated)
    cached_emb = _load_cache(cache_key)
    if cached_emb is not None and cached_emb.shape == (N, N_ESM_DIMS):
        print(f"[embedder] Cache hit — skipping extraction for {N} sequences")
        return cached_emb.astype(np.float32)

    print(f"[embedder] Extracting embeddings: {N} sequences on {DEVICE}")

    tokenizer, model = _load_model()

    X = np.zeros((N, N_ESM_DIMS), dtype=np.float32)
    current_batch = BATCH_SIZE

    with torch.no_grad():
        i = 0
        while i < N:
            batch_end  = min(i + current_batch, N)
            batch_seqs = seqs_truncated[i:batch_end]

            try:
                inputs = tokenizer(
                    batch_seqs,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                    max_length=MAX_SEQ_LENGTH + 2,
                )
                inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

                outputs       = model(**inputs)
                hidden_states = outputs.hidden_states

                for j, seq in enumerate(batch_seqs):
                    seq_len    = len(seq)
                    layer_vecs = []

                    for layer_idx in LAYERS_TO_USE:
                        h = hidden_states[layer_idx][j, 1:seq_len + 1, :]
                        v = h.mean(dim=0)
                        if DEVICE == "cuda":
                            v = v.float().cpu().numpy()
                        else:
                            v = v.numpy()
                        layer_vecs.append(v)

                    X[i + j] = np.concatenate(layer_vecs)

                i += len(batch_seqs)
                print(f"[embedder] {i}/{N} done")

            except RuntimeError as e:
                if "out of memory" in str(e).lower() and current_batch > 1:
                    current_batch = max(1, current_batch // 2)
                    print(f"[embedder] OOM — batch size reduced to {current_batch}")
                    if DEVICE == "cuda":
                        torch.cuda.empty_cache()
                else:
                    raise

    # Sanitise
    bad = np.isnan(X).sum() + np.isinf(X).sum()
    if bad > 0:
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    # Save cache
    _save_cache(cache_key, X)
    print(f"[embedder] Saved to cache: {cache_key}")

    return X


def build_features(X_esm: np.ndarray, taxon_ids: list,
                   top50_taxa: list) -> np.ndarray:
    """
    Append 51-dim taxonomy features to ESM embeddings.
    Returns (N, 15411) feature matrix.
    """
    N = X_esm.shape[0]
    taxon_to_i = {t: i for i, t in enumerate(top50_taxa)}
    X_tax = np.zeros((N, 51), dtype=np.float32)

    for i, tx in enumerate(taxon_ids):
        if tx is not None and tx in taxon_to_i:
            X_tax[i, taxon_to_i[tx]] = 1.0
        else:
            X_tax[i, 50] = 1.0   # unknown species flag

    return np.hstack([X_esm, X_tax])
