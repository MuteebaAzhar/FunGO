# app.py
"""
FunGO v2.0 — Flask REST API
============================
Endpoints:
  GET  /health
  GET  /model/info
  GET  /taxonomy/search?q=...
  GET  /taxonomy/verify?taxon_id=...
  POST /predict
  GET  /predict/csv?job_id=...
  POST /predict/debug
"""

import csv, io, logging, re as _re, sys, time
from collections import OrderedDict
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import config, predictor, embedder
import filter as flt
import taxonomy

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("fungo.app")

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

_csv_store: OrderedDict = OrderedDict()
_CSV_MAX = 50

def _store_csv(job_id, predictions):
    if len(_csv_store) >= _CSV_MAX:
        _csv_store.popitem(last=False)
    _csv_store[job_id] = {"predictions": predictions, "ts": time.time()}

def _make_csv(predictions):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["protein_id","go_term","ontology","ontology_label",
                "tier","tier_label","confidence","ia_weight","combined_score","threshold"])
    for pid, data in predictions.items():
        for p in data.get("all", []):
            w.writerow([pid, p.get("go_term",""), p.get("ontology",""),
                p.get("ontology_label",""), p.get("tier",""), p.get("tier_label",""),
                p.get("confidence",""), p.get("ia_weight",""),
                p.get("combined_score",""), p.get("threshold","")])
    return out.getvalue()

_OX_RE = _re.compile(r"OX=(\d+)")

def _parse_taxon_id(header):
    m = _OX_RE.search(header or "")
    return int(m.group(1)) if m else None

def parse_fasta(fasta_text):
    proteins, current_id, current_hdr, current_seq = [], None, None, []
    for raw_line in fasta_text.splitlines():
        line = raw_line.strip()
        if not line: continue
        if line.startswith(">"):
            if current_id is not None:
                seq = "".join(current_seq).upper()
                if seq:
                    proteins.append({"id": current_id, "seq": seq,
                        "header": current_hdr, "taxon_id": _parse_taxon_id(current_hdr)})
            current_hdr = line[1:].strip()
            parts = current_hdr.split("|")
            current_id = parts[1] if len(parts) >= 3 else current_hdr.split()[0]
            current_seq = []
        else:
            current_seq.append(line)
    if current_id is not None:
        seq = "".join(current_seq).upper()
        if seq:
            proteins.append({"id": current_id, "seq": seq,
                "header": current_hdr, "taxon_id": _parse_taxon_id(current_hdr)})
    if not proteins:
        raise ValueError("No valid protein sequences found in FASTA input.")
    return proteins

def _run_prediction(fasta_text, taxon_id_override):
    proteins = parse_fasta(fasta_text)
    if len(proteins) > config.MAX_SEQUENCES:
        raise ValueError(f"Too many sequences ({len(proteins)}). Max: {config.MAX_SEQUENCES}.")
    protein_ids = [p["id"] for p in proteins]
    sequences   = [p["seq"] for p in proteins]
    taxon_ids   = [taxon_id_override if taxon_id_override is not None else p["taxon_id"] for p in proteins]
    log.info("Proteins: %s | Taxon IDs: %s", protein_ids, taxon_ids)
    t0 = time.perf_counter()
    X_esm   = embedder.extract(sequences)
    top50   = predictor.get_top50_taxa()
    X_final = embedder.build_features(X_esm, taxon_ids, top50)
    raw_preds  = predictor.predict(X_final, protein_ids)
    ia_weights = predictor.get_ia_weights()
    for p in raw_preds:
        p["ia_weight"] = round(float(ia_weights.get(p["go_term"], 0.0)), 4)
    return proteins, raw_preds, ia_weights, round(time.perf_counter() - t0, 2)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "device": config.DEVICE, "fp16": config.USE_FP16, "version": "2.0.0"})

@app.route("/model/info", methods=["GET"])
def model_info():
    try: stats = predictor.get_model_stats()
    except RuntimeError as e: return jsonify({"error": str(e)}), 503
    return jsonify({"device": config.DEVICE, "fp16": config.USE_FP16,
        "model_name": config.MODEL_NAME, "layers": config.LAYERS_TO_USE,
        "ontologies": stats, "top50_taxa_count": len(predictor.get_top50_taxa()),
        "thresholds": {
            "STRONG":     {"min_ia": config.TIER_GOLD_IA,   "min_conf": config.TIER_GOLD_CONF},
            "MODERATE":   {"min_ia": config.TIER_GOOD_IA,   "min_conf": config.TIER_GOOD_CONF},
            "INDICATIVE": {"min_ia": config.TIER_SILVER_IA, "min_conf": config.TIER_SILVER_CONF},
        }, "display_limit": flt.TOP_N_DISPLAY})

@app.route("/taxonomy/search", methods=["GET"])
def taxonomy_search():
    q = request.args.get("q", "").strip()
    if len(q) < 2: return jsonify({"error": "Query must be at least 2 characters."}), 400
    try: max_r = min(int(request.args.get("max_results", 8)), 20)
    except: max_r = 8
    return jsonify({"query": q, "results": taxonomy.search_species(q, max_results=max_r)})

@app.route("/taxonomy/verify", methods=["GET"])
def taxonomy_verify():
    raw = request.args.get("taxon_id", "")
    if not raw: return jsonify({"error": "taxon_id required."}), 400
    try: taxon_id = int(raw)
    except: return jsonify({"error": f"Invalid taxon_id: '{raw}'"}), 400
    return jsonify(taxonomy.resolve_taxon(taxon_id, predictor.get_top50_taxa()))

@app.route("/predict", methods=["POST"])
def predict():
    if not request.is_json: return jsonify({"error": "Content-Type must be application/json."}), 415
    body = request.get_json(silent=True) or {}
    fasta_text = body.get("fasta", "").strip()
    if not fasta_text: return jsonify({"error": "'fasta' field is required."}), 400
    taxon_id_override = None
    if "taxon_id" in body:
        try: taxon_id_override = int(body["taxon_id"])
        except: return jsonify({"error": f"Invalid taxon_id: {body['taxon_id']!r}"}), 400
    try:
        proteins, raw_preds, ia_weights, elapsed = _run_prediction(fasta_text, taxon_id_override)
    except ValueError as e: return jsonify({"error": str(e)}), 400
    except RuntimeError as e: return jsonify({"error": str(e)}), 503
    except Exception as e:
        log.exception("Prediction error"); return jsonify({"error": str(e)}), 500

    protein_ids = [p["id"] for p in proteins]
    raw_by_pid  = {pid: [] for pid in protein_ids}
    for pred in raw_preds: raw_by_pid[pred["protein_id"]].append(pred)

    predictions, csv_data, total_display, total_all = {}, {}, 0, 0
    for prot in proteins:
        pid = prot["id"]
        res = flt.filter_predictions(raw_by_pid[pid], ia_weights)
        display, all_f = res["display"], res["all"]
        total_display += len(display); total_all += len(all_f)
        predictions[pid] = {"taxon_id": prot["taxon_id"],
            "summary": flt.summarise(display, all_f, pid),
            "display": display, "total_all": len(all_f)}
        csv_data[pid] = {"all": all_f}

    job_id = str(int(time.time() * 1000))
    _store_csv(job_id, csv_data)
    return jsonify({"job_id": job_id,
        "metadata": {"n_proteins": len(protein_ids), "device": config.DEVICE,
            "total_raw_predictions": len(raw_preds), "total_filtered": total_all,
            "total_displayed": total_display, "display_limit": flt.TOP_N_DISPLAY,
            "elapsed_seconds": elapsed},
        "predictions": predictions})

@app.route("/predict/csv", methods=["GET"])
def download_csv():
    job_id = request.args.get("job_id", "").strip()
    if not job_id: return jsonify({"error": "job_id required."}), 400
    job = _csv_store.get(job_id)
    if not job: return jsonify({"error": f"Job '{job_id}' not found. Re-run prediction."}), 404
    return Response(_make_csv(job["predictions"]), mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=fungo_{job_id}.csv"})

@app.route("/predict/debug", methods=["POST"])
def predict_debug():
    if not request.is_json: return jsonify({"error": "Content-Type must be application/json."}), 415
    body = request.get_json(silent=True) or {}
    fasta_text = body.get("fasta", "").strip()
    if not fasta_text: return jsonify({"error": "'fasta' required."}), 400
    taxon_id_override = None
    if "taxon_id" in body:
        try: taxon_id_override = int(body["taxon_id"])
        except: return jsonify({"error": f"Invalid taxon_id: {body['taxon_id']!r}"}), 400
    try:
        proteins, raw_preds, ia_weights, elapsed = _run_prediction(fasta_text, taxon_id_override)
    except ValueError as e: return jsonify({"error": str(e)}), 400
    except RuntimeError as e: return jsonify({"error": str(e)}), 503
    except Exception as e:
        log.exception("Debug error"); return jsonify({"error": str(e)}), 500

    protein_ids = [p["id"] for p in proteins]
    raw_by_pid  = {pid: [] for pid in protein_ids}
    for pred in raw_preds: raw_by_pid[pred["protein_id"]].append(pred)

    thr = {"STRONG": {"min_ia": config.TIER_GOLD_IA, "min_conf": config.TIER_GOLD_CONF},
           "MODERATE": {"min_ia": config.TIER_GOOD_IA, "min_conf": config.TIER_GOOD_CONF},
           "INDICATIVE": {"min_ia": config.TIER_SILVER_IA, "min_conf": config.TIER_SILVER_CONF}}
    predictions = {}
    for prot in proteins:
        pid = prot["id"]
        res = flt.filter_predictions(raw_by_pid[pid], ia_weights)
        display, all_f = res["display"], res["all"]
        accepted = {p["go_term"] for p in all_f}
        fo = []
        for pred in raw_by_pid[pid]:
            go = pred["go_term"]
            if go in accepted: continue
            ia, conf = pred.get("ia_weight", float(ia_weights.get(go, 0.0))), pred["confidence"]
            if go in config.BLACKLIST_TERMS: reason = "blacklisted"
            elif ia <= config.TIER_SILVER_IA: reason = f"ia_too_low (ia={ia:.4f})"
            elif conf < config.TIER_SILVER_CONF: reason = f"conf_too_low (conf={conf:.4f})"
            else: reason = "below_all_tiers"
            fo.append({"go_term": go, "ontology": pred["ontology"], "confidence": conf,
                       "ia_weight": ia, "threshold": pred.get("threshold"), "reason": reason})
        fo.sort(key=lambda x: -x["ia_weight"])
        predictions[pid] = {"taxon_id": prot["taxon_id"],
            "summary": flt.summarise(display, all_f, pid),
            "display": display, "all_filtered": all_f,
            "filtered_out": fo, "thresholds_used": thr}
    return jsonify({"metadata": {"n_proteins": len(protein_ids), "device": config.DEVICE,
        "total_raw": len(raw_preds), "elapsed_seconds": elapsed}, "predictions": predictions})

@app.errorhandler(404)
def not_found(e): return jsonify({"error": "Endpoint not found."}), 404
@app.errorhandler(413)
def too_large(e): return jsonify({"error": "Request too large (max 2 MB)."}), 413
@app.errorhandler(500)
def internal(e):
    log.exception("Unhandled error"); return jsonify({"error": "Internal server error."}), 500

if __name__ == "__main__":
    log.info("FunGO v2.0 starting …")
    config.ensure_dirs()
    if not config.validate_paths():
        log.error("Required paths missing — exiting."); sys.exit(1)
    predictor.load_all()
    log.info("Ready on port %d", config.PORT)
    app.run(host="0.0.0.0", port=config.PORT, debug=config.DEBUG)
