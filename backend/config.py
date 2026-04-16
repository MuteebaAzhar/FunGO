# config.py
"""
FunGO Backend — Central Configuration
======================================
ONLY change paths in this file. Nothing else needs editing.

How to use:
  - Update PKL_DIR, VOCAB_PKL, IA_PKL, FEAT_META to point to your model files
  - Update MODEL_CACHE_DIR to point to your ESM2 weights cache
  - All other settings work as-is
"""

import logging
import os
from pathlib import Path
import torch

logger = logging.getLogger("config")

# ── DEVICE (auto-detected) ────────────────────────────────────
DEVICE   = "cuda" if torch.cuda.is_available() else "cpu"
USE_FP16 = DEVICE == "cuda"

# ── MODEL PATHS — UPDATE THESE TO MATCH YOUR SYSTEM ──────────
PKL_DIR   = Path(os.environ.get("FUNGO_PKL_DIR",   "/mnt/f/research/thesis/pipeline_outputs/models"))
VOCAB_PKL = Path(os.environ.get("FUNGO_VOCAB_PKL", "/mnt/f/research/thesis/pipeline_outputs/labels/vocabularies.pkl"))
IA_PKL    = Path(os.environ.get("FUNGO_IA_PKL",    "/mnt/f/research/thesis/pipeline_outputs/go_data/ia_weights.pkl"))
FEAT_META = Path(os.environ.get("FUNGO_FEAT_META", "/mnt/f/research/thesis/pipeline_outputs/features/feature_metadata.json"))

# ── ESM2 SETTINGS ─────────────────────────────────────────────
MODEL_CACHE_DIR     = Path(os.environ.get("FUNGO_MODEL_CACHE", "/mnt/e/repeat/embeddings/model_cache"))
MODEL_NAME          = "facebook/esm2_t36_3B_UR50D"
LAYERS_TO_USE       = [30, 31, 32, 33, 34, 35]
MAX_SEQ_LENGTH      = 1400
BATCH_SIZE          = 4 if DEVICE == "cpu" else 16
TRANSFORMERS_OFFLINE = os.environ.get("FUNGO_OFFLINE", "1")

# ── EMBEDDING CACHE ───────────────────────────────────────────
EMB_CACHE_DIR = Path(os.environ.get("FUNGO_EMB_CACHE", "./embedding_cache"))

# ── FILTER THRESHOLDS (do not change) ────────────────────────
BLACKLIST_TERMS = {
    "GO:0003674","GO:0008150","GO:0005575","GO:0005488",
    "GO:0043226","GO:0043229","GO:0043227","GO:0043231",
    "GO:0110165","GO:0005622","GO:0005623","GO:0044464",
    "GO:0043232","GO:0044424","GO:0009987","GO:0065007",
    "GO:0050794","GO:0019222","GO:0060255","GO:0080090",
    "GO:0050789",
}

# Strong Evidence  (was GOLD)
TIER_GOLD_IA    = 5.0
TIER_GOLD_CONF  = 0.30

# Moderate Evidence (was GOOD)
TIER_GOOD_IA    = 2.0
TIER_GOOD_CONF  = 0.50

# Indicative        (was SILVER)
TIER_SILVER_IA   = 1.0
TIER_SILVER_CONF = 0.65

# ── NCBI TAXONOMY API ─────────────────────────────────────────
NCBI_SEARCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
NCBI_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
NCBI_FETCH_URL   = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
NCBI_TOOL        = "FunGO"
NCBI_EMAIL       = "fungo@research.com"

# ── FLASK ─────────────────────────────────────────────────────
PORT          = int(os.environ.get("FUNGO_PORT", 5000))
DEBUG         = os.environ.get("FUNGO_DEBUG", "0") == "1"
MAX_SEQUENCES = int(os.environ.get("FUNGO_MAX_SEQ", 10))


# ── Runtime helpers ───────────────────────────────────────────

def ensure_dirs():
    """Create required runtime directories. Called once at startup."""
    EMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("[config] EMB_CACHE_DIR ready → %s", EMB_CACHE_DIR)


def validate_paths() -> bool:
    """
    Check that all required model files exist.
    Returns True if all found, False if any missing.
    Called at startup before loading models.
    """
    required = {
        "PKL_DIR":   PKL_DIR,
        "VOCAB_PKL": VOCAB_PKL,
        "IA_PKL":    IA_PKL,
        "FEAT_META": FEAT_META,
        "MODEL_CACHE_DIR": MODEL_CACHE_DIR,
    }
    all_ok = True
    for name, path in required.items():
        if path.exists():
            logger.info("[config] ✓ %-18s → %s", name, path)
        else:
            logger.error("[config] ✗ %-18s → %s  (NOT FOUND)", name, path)
            all_ok = False
    return all_ok
