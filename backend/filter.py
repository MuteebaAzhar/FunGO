# filter.py
"""
FunGO — Smart Tier Filtering
==============================
Removes generic/root GO terms and assigns evidence tiers
to remaining predictions.

Changes from original:
  1. Tier names updated:
       GOLD   → STRONG     (Strong Evidence)
       GOOD   → MODERATE   (Moderate Evidence)
       SILVER → INDICATIVE
  2. Combined score = ia_weight × confidence
     Used for ranking — more scientifically sound.
  3. filter_predictions() returns a dict with two keys:
       "display" — top 20 by combined score (for UI screen)
       "all"     — full filtered list (for CSV download)
  4. summarise() updated to use new tier keys.
  5. Blacklist + IA/confidence thresholds → completely unchanged.
"""

import logging
from config import (
    BLACKLIST_TERMS,
    TIER_GOLD_IA,   TIER_GOLD_CONF,
    TIER_GOOD_IA,   TIER_GOOD_CONF,
    TIER_SILVER_IA, TIER_SILVER_CONF,
)

logger = logging.getLogger(__name__)

ONT_LABELS = {
    "MFO": "Molecular Function",
    "BPO": "Biological Process",
    "CCO": "Cellular Component",
}

TIER_LABELS = {
    "STRONG":     "Strong Evidence",
    "MODERATE":   "Moderate Evidence",
    "INDICATIVE": "Indicative",
}

TIER_RANK = {"STRONG": 0, "MODERATE": 1, "INDICATIVE": 2}

# Max predictions shown on screen per protein
TOP_N_DISPLAY = 20


def assign_tier(go_term: str, ia: float, confidence: float) -> str:
    """
    Assign evidence tier. Thresholds unchanged from original.

    Returns: "STRONG" | "MODERATE" | "INDICATIVE" | "NOISE"
    """
    if go_term in BLACKLIST_TERMS:
        return "NOISE"
    if ia > TIER_GOLD_IA   and confidence >= TIER_GOLD_CONF:
        return "STRONG"
    if ia > TIER_GOOD_IA   and confidence >= TIER_GOOD_CONF:
        return "MODERATE"
    if ia > TIER_SILVER_IA and confidence >= TIER_SILVER_CONF:
        return "INDICATIVE"
    return "NOISE"


def combined_score(ia: float, confidence: float) -> float:
    """
    Ranking score = ia_weight × confidence.
    Balances specificity (IA) and model certainty (confidence).
    """
    return round(ia * confidence, 6)


def filter_predictions(raw_predictions: list, ia_weights: dict) -> dict:
    """
    Filter raw predictions and return display + full sets.

    Returns
    -------
    {
      "display": top-20 predictions (sorted by combined_score desc),
      "all":     all filtered predictions (for CSV)
    }

    Each prediction dict contains:
      go_term, ontology, ontology_label, confidence, threshold,
      ia_weight, combined_score, tier, tier_rank, tier_label
    """
    filtered = []

    for pred in raw_predictions:
        go_term    = pred["go_term"]
        confidence = pred["confidence"]
        ia         = float(ia_weights.get(go_term, 0.0))
        tier       = assign_tier(go_term, ia, confidence)

        if tier == "NOISE":
            continue

        if tier not in TIER_RANK:
            logger.warning("Unknown tier %r for %s — skipping", tier, go_term)
            continue

        score = combined_score(ia, confidence)

        filtered.append({
            **pred,
            "ia_weight":      round(ia, 4),
            "combined_score": score,
            "tier":           tier,
            "tier_rank":      TIER_RANK[tier],
            "tier_label":     TIER_LABELS[tier],
            "ontology_label": ONT_LABELS.get(pred["ontology"], pred["ontology"]),
        })

    # Sort by combined score descending, tier_rank as tiebreaker
    filtered.sort(key=lambda x: (-x["combined_score"], x["tier_rank"]))

    return {
        "display": filtered[:TOP_N_DISPLAY],
        "all":     filtered,
    }


def summarise(filtered_display: list, all_filtered: list, protein_id: str) -> dict:
    """
    Per-protein summary. Counts are over ALL filtered (not just top-20).
    """
    ont_counts  = {"MFO": 0, "BPO": 0, "CCO": 0}
    tier_counts = {"STRONG": 0, "MODERATE": 0, "INDICATIVE": 0}

    for p in all_filtered:
        ont = p.get("ontology", "")
        if ont in ont_counts:
            ont_counts[ont] += 1
        t = p.get("tier", "")
        if t in tier_counts:
            tier_counts[t] += 1

    n = len(all_filtered)
    return {
        "protein_id":          protein_id,
        "total_filtered":      n,
        "displayed":           len(filtered_display),
        "by_ontology":         ont_counts,
        "by_tier":             tier_counts,
        "has_strong_evidence": tier_counts["STRONG"] > 0,
        "avg_confidence":      round(sum(p["confidence"]     for p in all_filtered) / n, 4) if n else 0.0,
        "avg_ia":              round(sum(p["ia_weight"]      for p in all_filtered) / n, 4) if n else 0.0,
        "avg_combined_score":  round(sum(p["combined_score"] for p in all_filtered) / n, 4) if n else 0.0,
    }
