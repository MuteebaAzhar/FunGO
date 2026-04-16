# taxonomy.py
"""
FunGO — NCBI Taxonomy Service
===============================
Species name → taxon ID lookup and reverse lookup.

Fixes applied:
  1. UID string/int consistency — result_map keys are always strings,
     now explicitly uses str(uid) so 9606 never resolves to {}.
  2. Species-rank preference — results sorted so "species" rank
     appears before "genus". Prevents 9605 (Homo genus) showing
     before 9606 (Homo sapiens species).
  3. Exact-name boost — exact query match moved to position 0.
  4. Cache key includes max_results to prevent stale smaller lists.
  5. xml.etree.ElementTree replaces fragile regex XML parsing.
  6. Retry logic — 3 attempts with 2s gap on connection errors.
"""

import logging
import time
import xml.etree.ElementTree as ET
import requests

from config import (
    NCBI_SEARCH_URL, NCBI_SUMMARY_URL, NCBI_FETCH_URL,
    NCBI_TOOL, NCBI_EMAIL,
)

logger  = logging.getLogger(__name__)
HEADERS = {"User-Agent": f"FunGO/1.0 ({NCBI_EMAIL})"}
TIMEOUT = 10
RETRIES = 3
RETRY_DELAY = 2

_RANK_PRIORITY = {
    "species": 0, "subspecies": 1, "varietas": 2,
    "forma": 3, "strain": 4, "no rank": 5,
    "genus": 6, "family": 7, "order": 8,
    "class": 9, "phylum": 10, "kingdom": 11, "superkingdom": 12,
}

def _rank_priority(rank: str) -> int:
    return _RANK_PRIORITY.get(rank.lower().strip(), 99)

_search_cache: dict = {}
_id_to_info_cache: dict = {}


def _ncbi_get(url: str, params: dict) -> requests.Response:
    last_exc = None
    for attempt in range(1, RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=TIMEOUT, headers=HEADERS)
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < RETRIES:
                logger.warning("[taxonomy] Request error (attempt %d/%d): %s — retrying in %ds",
                               attempt, RETRIES, exc, RETRY_DELAY)
                time.sleep(RETRY_DELAY)
    raise last_exc


def search_species(query: str, max_results: int = 8) -> list:
    """
    Search NCBI taxonomy by species name.
    Returns [{taxon_id, scientific_name, common_name, rank, division}]
    Sorted: species rank first, exact name match at position 0.
    """
    query = query.strip()
    if len(query) < 2:
        return []

    cache_key = (query.lower(), max_results)
    if cache_key in _search_cache:
        return _search_cache[cache_key]

    try:
        search_resp = _ncbi_get(NCBI_SEARCH_URL, {
            "db": "taxonomy", "term": query,
            "retmax": max_results, "retmode": "json",
            "tool": NCBI_TOOL, "email": NCBI_EMAIL,
        })
        ids = search_resp.json().get("esearchresult", {}).get("idlist", [])

        if not ids:
            _search_cache[cache_key] = []
            return []

        summary_resp = _ncbi_get(NCBI_SUMMARY_URL, {
            "db": "taxonomy", "id": ",".join(ids),
            "retmode": "json", "tool": NCBI_TOOL, "email": NCBI_EMAIL,
        })
        result_map = summary_resp.json().get("result", {})
        uids = result_map.get("uids", ids)

        results = []
        for uid in uids:
            item = result_map.get(str(uid), {})   # FIX: explicit str()
            if not item:
                continue
            results.append({
                "taxon_id":        int(uid),
                "scientific_name": item.get("scientificname", ""),
                "common_name":     item.get("commonname", ""),
                "rank":            item.get("rank", ""),
                "division":        item.get("division", ""),
            })

        # FIX: sort by rank — species before genus
        results.sort(key=lambda r: _rank_priority(r.get("rank", "")))

        # FIX: exact name match → front of list
        q_lower = query.lower()
        exact = [r for r in results if r["scientific_name"].lower() == q_lower]
        rest  = [r for r in results if r["scientific_name"].lower() != q_lower]
        results = exact + rest

        _search_cache[cache_key] = results
        logger.info("[taxonomy] search %r → %d results", query, len(results))
        return results

    except Exception as exc:
        logger.error("[taxonomy] search_species(%r) failed: %s", query, exc)
        return [{"error": str(exc)}]


def get_taxon_info(taxon_id: int) -> dict:
    """
    Reverse lookup: taxon ID → full species info with lineage.
    Uses xml.etree.ElementTree — handles multi-line XML correctly.
    """
    if taxon_id in _id_to_info_cache:
        return _id_to_info_cache[taxon_id]

    base = {
        "taxon_id": taxon_id, "scientific_name": "",
        "common_name": "", "rank": "", "division": "",
        "lineage": "", "verified": False,
    }

    try:
        resp = _ncbi_get(NCBI_FETCH_URL, {
            "db": "taxonomy", "id": taxon_id,
            "retmode": "xml", "tool": NCBI_TOOL, "email": NCBI_EMAIL,
        })

        root     = ET.fromstring(resp.text)
        taxon_el = root.find("Taxon")

        if taxon_el is None:
            base["error"] = "Taxon element not found in NCBI XML"
            return base

        def txt(tag: str) -> str:
            el = taxon_el.find(tag)
            return (el.text or "").strip() if el is not None else ""

        lineage_parts = [
            (a.findtext("ScientificName") or "").strip()
            for a in taxon_el.findall("./LineageEx/Taxon")
        ]

        common = (taxon_el.findtext("OtherNames/CommonName") or
                  taxon_el.findtext("CommonName") or "")

        info = {
            **base,
            "scientific_name": txt("ScientificName"),
            "common_name":     common.strip(),
            "rank":            txt("Rank"),
            "division":        txt("Division"),
            "lineage":         " > ".join(p for p in lineage_parts if p),
            "verified":        True,
        }

        _id_to_info_cache[taxon_id] = info
        logger.info("[taxonomy] Resolved taxon %d → %s", taxon_id, info["scientific_name"])
        return info

    except ET.ParseError as exc:
        logger.error("[taxonomy] XML parse error for taxon %d: %s", taxon_id, exc)
        base["error"] = f"XML parse error: {exc}"
        return base
    except Exception as exc:
        logger.error("[taxonomy] get_taxon_info(%d) failed: %s", taxon_id, exc)
        base["error"] = str(exc)
        return base


def resolve_taxon(taxon_id: int, top50_taxa: list) -> dict:
    """Check training-set membership for a taxon ID."""
    info        = get_taxon_info(taxon_id)
    in_training = taxon_id in top50_taxa
    return {
        **info,
        "in_training":     in_training,
        "training_status": "in_training_data" if in_training else "unknown_species_fallback",
    }
