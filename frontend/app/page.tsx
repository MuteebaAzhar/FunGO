'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import clsx from 'clsx'

// ── Types ──────────────────────────────────────────────────────
type Tier = 'STRONG' | 'MODERATE' | 'INDICATIVE'

interface Pred {
  go_term: string; ontology: string; ontology_label: string;
  confidence: number; ia_weight: number; combined_score: number;
  tier: Tier; tier_label: string; threshold: number;
}
interface Summary {
  protein_id: string; total_filtered: number; displayed: number;
  by_ontology: { MFO: number; BPO: number; CCO: number };
  by_tier: { STRONG: number; MODERATE: number; INDICATIVE: number };
  has_strong_evidence: boolean; avg_confidence: number;
  avg_ia: number; avg_combined_score: number;
}
interface ProteinResult {
  taxon_id: number | null; summary: Summary;
  display: Pred[]; total_all: number;
}
interface PredResponse {
  job_id: string;
  metadata: {
    n_proteins: number; device: string;
    total_raw_predictions: number; total_filtered: number;
    total_displayed: number; display_limit: number; elapsed_seconds: number;
  };
  predictions: Record<string, ProteinResult>;
}
interface ModelInfo {
  device: string; fp16: boolean;
  ontologies: { MFO: number; BPO: number; CCO: number };
  thresholds: Record<string, { min_ia: number; min_conf: number }>;
  display_limit: number;
}

// ── Developer team ─────────────────────────────────────────────
const TEAM = [
  {
    name: 'Dr. Beenish Maqsood',
    role: 'Principal Investigator',
    title: 'Assistant Professor',
    dept: 'School of Biochemistry and Biotechnology',
    uni: 'University of the Punjab, Lahore',
    email: 'beenish.ibb@pu.edu.pk',
    initials: 'BM',
    color: '#1B5FA8',
  },
  {
    name: 'Dr. Naeem Mahmood',
    role: 'Co-Supervisor',
    title: 'Assistant Professor',
    dept: 'School of Biochemistry and Biotechnology',
    uni: 'University of the Punjab, Lahore',
    email: 'naeem.sbb@pu.edu.pk',
    initials: 'NM',
    color: '#3E9E3E',
  },
  {
    name: 'Muteeba Azhar',
    role: 'Lead Developer',
    title: 'MS Researcher',
    dept: 'School of Biochemistry and Biotechnology',
    uni: 'University of the Punjab, Lahore',
    email: '',
    initials: 'MA',
    color: '#6366f1',
  },
]

// ── Constants ──────────────────────────────────────────────────
const EXAMPLE = `>sp|P00519|ABL1_HUMAN Tyrosine-protein kinase ABL1 OS=Homo sapiens OX=9606 GN=ABL1 PE=1 SV=4
MLEICLKLVGCKSKKGLSSSSSCYLEEALQRPVASDFEPQGLSEAARWNSKENLLAGPSENDPNLFVALYDFVASGDNTLSITKGEKLRVLGYNHNGEWCEAQTKNGQGWVPSNYITPVNSLEKHSWYHGPVSRNAAEYLLSSGINGSFLVRESESSPGQRSISLRYEGRVYHYRINTASDGKLYVSSESRFNTLAELVHHHSTVADGLITTLHYPAPKRNKPTVYGVSPNYDKWEMERTDITMKHKLGGGQYGEVYEGVWKKYSLTVAVKTLKEDTMEVEEFLKEAAVMKEIKHPNLVQLLGVCTREPPFYIITEFMTYGNLLDYLRECNRQEVNAVVLLYMATQISSAMEYLEKKNFIHRDLAARNCLVGENHLVKVADFGLSRLMTGDTYTAHAGAKFPIKWTAPESLAYNKFSIKSDK`

const ONT: Record<string, { pill: string; dot: string; label: string }> = {
  MFO: { pill: 'bg-purple-50 text-purple-700 border border-purple-200', dot: '#7c3aed', label: 'Molecular Function' },
  BPO: { pill: 'bg-teal-50  text-teal-700  border border-teal-200',    dot: '#0d9488', label: 'Biological Process' },
  CCO: { pill: 'bg-amber-50 text-amber-700 border border-amber-200',   dot: '#d97706', label: 'Cellular Component' },
}

const TIER_CFG: Record<Tier, { bg: string; text: string; border: string; dot: string; shadow: string; label: string }> = {
  STRONG:     { bg:'bg-amber-50',  text:'text-amber-800', border:'border-amber-300', dot:'#d97706', shadow:'sh-strong',   label:'Strong Evidence'   },
  MODERATE:   { bg:'bg-blue-50',   text:'text-blue-800',  border:'border-blue-200',  dot:'#1B5FA8', shadow:'sh-moderate', label:'Moderate Evidence' },
  INDICATIVE: { bg:'bg-gray-50',   text:'text-gray-700',  border:'border-gray-300',  dot:'#6b7280', shadow:'sh-indicative',label:'Indicative'       },
}

// ── Small atoms ────────────────────────────────────────────────
function StatusDot({ online }: { online: boolean | null }) {
  if (online === null) return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block animate-pulse" />
  return <span className={clsx('w-2 h-2 rounded-full inline-block', online ? 'bg-green-500' : 'bg-red-400')} />
}

function TierBadge({ tier }: { tier: Tier }) {
  const c = TIER_CFG[tier]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', c.bg, c.text, c.border, c.shadow)}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

function OntBadge({ ont }: { ont: string }) {
  const o = ONT[ont] ?? { pill: 'bg-gray-50 text-gray-600 border border-gray-200', dot: '#6b7280', label: ont }
  return <span className={clsx('inline-block px-2 py-0.5 rounded text-xs font-mono font-medium', o.pill)}>{ont}</span>
}

function ConfBar({ v }: { v: number }) {
  const pct = Math.round(v * 100)
  const color = v >= 0.8 ? '#3E9E3E' : v >= 0.65 ? '#1B5FA8' : v >= 0.5 ? '#d97706' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono font-medium w-8" style={{ color }}>{pct}%</span>
    </div>
  )
}

function Toggle({ on, set, color = 'blue' }: { on: boolean; set: (v: boolean) => void; color?: string }) {
  const isBlue = color === 'blue'
  return (
    <button
      onClick={() => set(!on)}
      className={clsx('relative rounded-full border transition-all cursor-pointer',
        on ? (isBlue ? 'bg-primary/10 border-primary/40' : 'bg-indigo-50 border-indigo-300') : 'bg-gray-100 border-gray-200'
      )}
      style={{ width: 40, height: 22 }}
    >
      <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full transition-transform',
        on ? `translate-x-5 ${isBlue ? 'bg-primary' : 'bg-indigo-500'}` : 'translate-x-0.5 bg-gray-400'
      )} style={{ margin: 1 }} />
    </button>
  )
}

// ── Protein result card ────────────────────────────────────────
function ProteinCard({ pid, data, jobId, idx }: { pid: string; data: ProteinResult; jobId: string; idx: number }) {
  const { summary: s, display, total_all } = data
  const [debugOpen, setDebugOpen] = useState(false)

  const handleCsvDownload = () => {
    window.open(`/api/predict/csv?job_id=${jobId}`, '_blank')
  }

  return (
    <div className="card fade-up" style={{ animationDelay: `${idx * 0.07}s` }}>

      {/* ── Header ── */}
      <div className="card-head flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-primary">{pid}</span>
            {data.taxon_id && (
              <span className="text-xs text-ink3 font-mono bg-surface px-1.5 py-0.5 rounded border border-edge">
                OX={data.taxon_id}
              </span>
            )}
            {s.has_strong_evidence && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                Strong Evidence hits
              </span>
            )}
          </div>
          <p className="text-xs text-ink3 mt-1">
            {s.displayed} shown (top 20) &middot; {total_all} total filtered &middot; avg score {s.avg_combined_score.toFixed(3)}
          </p>
        </div>

        {/* Ontology mini-counts */}
        <div className="flex items-center gap-4">
          {(['MFO','BPO','CCO'] as const).map(o => (
            <div key={o} className="text-center">
              <div className="text-lg font-bold leading-none" style={{ color: ONT[o].dot }}>{s.by_ontology[o]}</div>
              <div className="text-xs text-ink3 mt-0.5">{o}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tier summary bar ── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-edge bg-white flex-wrap">
        {(['STRONG','MODERATE','INDICATIVE'] as Tier[]).map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <TierBadge tier={t} />
            <span className="text-xs text-ink3 font-medium">{s.by_tier[t]}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {total_all > 20 && (
            <span className="text-xs text-ink3">+{total_all - 20} more in CSV</span>
          )}
          <button
            onClick={handleCsvDownload}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v7M3.5 5.5L6 8l2.5-2.5M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Download CSV
          </button>
        </div>
      </div>

      {/* ── Predictions table ── */}
      {display.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-edge bg-surface">
                <th className="text-left px-5 py-2.5 text-ink3 font-semibold tracking-wide">GO Term</th>
                <th className="text-left px-3 py-2.5 text-ink3 font-semibold">Category</th>
                <th className="text-left px-3 py-2.5 text-ink3 font-semibold">Evidence</th>
                <th className="text-left px-3 py-2.5 text-ink3 font-semibold">Confidence</th>
                <th className="text-left px-3 py-2.5 text-ink3 font-semibold">IA Weight</th>
                <th className="text-left px-3 py-2.5 text-ink3 font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {display.map((p, i) => (
                <tr key={i} className={clsx('pred-row border-b border-edge/60 transition-colors', i % 2 === 0 ? 'bg-white' : 'bg-surface/40')}>
                  <td className="px-5 py-2.5">
                    <a
                      href={`https://amigo.geneontology.org/amigo/term/${p.go_term}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-primary hover:text-primary-dark hover:underline"
                    >
                      {p.go_term}
                    </a>
                    <div className="text-ink3 text-xs mt-0.5">{p.ontology_label}</div>
                  </td>
                  <td className="px-3 py-2.5"><OntBadge ont={p.ontology} /></td>
                  <td className="px-3 py-2.5"><TierBadge tier={p.tier} /></td>
                  <td className="px-3 py-2.5"><ConfBar v={p.confidence} /></td>
                  <td className="px-3 py-2.5 font-mono text-ink2">{p.ia_weight.toFixed(4)}</td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-ink">{p.combined_score.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink3">No predictions passed the evidence filter for this protein.</p>
          <p className="text-xs text-ink3 mt-1">Use debug mode to see why predictions were filtered out.</p>
        </div>
      )}
    </div>
  )
}

// ── Loading state ──────────────────────────────────────────────
function LoadingCard() {
  return (
    <div className="card py-16 flex flex-col items-center gap-5">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-ink">Running prediction pipeline</p>
        <p className="text-xs text-ink3 mt-1">ESM2-t36-3B embedding + XGBoost scoring</p>
        <p className="text-xs text-ink3">This takes 20–60 s with embedding cache</p>
      </div>
      <div className="w-40 h-1 bg-surface2 rounded overflow-hidden relative">
        <div className="absolute inset-y-0 w-16 bg-primary/40 rounded scan" />
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────
export default function Page() {
  const [fasta,    setFasta]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [result,   setResult]   = useState<PredResponse | null>(null)
  const [info,     setInfo]     = useState<ModelInfo | null>(null)
  const [online,   setOnline]   = useState<boolean | null>(null)
  const [debug,    setDebug]    = useState(false)
  const [taxQ,     setTaxQ]     = useState('')
  const [taxRes,   setTaxRes]   = useState<any[]>([])
  const [taxLoad,  setTaxLoad]  = useState(false)
  const fileRef                 = useRef<HTMLInputElement>(null)
  const taxTimer                = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Health check
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setOnline(!!d?.status)
        if (d?.status) fetch('/api/model/info').then(r => r.json()).then(setInfo).catch(() => {})
      })
      .catch(() => setOnline(false))
  }, [])

  // Taxonomy search
  const taxSearch = (q: string) => {
    setTaxQ(q)
    if (taxTimer.current) clearTimeout(taxTimer.current)
    if (q.trim().length < 2) { setTaxRes([]); return }
    taxTimer.current = setTimeout(async () => {
      setTaxLoad(true)
      try {
        const r = await fetch(`/api/taxonomy/search?q=${encodeURIComponent(q)}`)
        const d = await r.json()
        setTaxRes(d.results ?? [])
      } catch { setTaxRes([]) }
      finally   { setTaxLoad(false) }
    }, 400)
  }

  // Submit
  const submit = useCallback(async () => {
    if (!fasta.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const endpoint = debug ? '/api/predict/debug' : '/api/predict'
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fasta }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setResult(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [fasta, debug])

  const seqCount = (fasta.match(/^>/gm) ?? []).length

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ════════════════════════════════════════════
          NAVBAR
      ════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 bg-white border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* Logo + tagline */}
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="FunGO Logo" width={110} height={46} className="object-contain" priority />
            <div className="hidden sm:block h-7 w-px bg-edge" />
            <span className="hidden sm:block text-xs text-ink3 italic">
              Beyond Prediction — Understanding Function.
            </span>
          </div>

          {/* API status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-ink3">
              <StatusDot online={online} />
              <span>{online === null ? 'Connecting…' : online ? `API ready · ${info?.device ?? '…'}` : 'API offline'}</span>
            </div>
            {info && (
              <span className="hidden md:block text-xs text-ink3 bg-surface border border-edge rounded px-2 py-1">
                MFO {info.ontologies.MFO?.toLocaleString()} · BPO {info.ontologies.BPO?.toLocaleString()} · CCO {info.ontologies.CCO?.toLocaleString()} classifiers
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ════════════════════════════════════════════
          HERO / ABOUT STRIP
      ════════════════════════════════════════════ */}
      <div className="bg-gradient-to-r from-primary/5 to-secondary/5 border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <p className="text-sm text-ink2 leading-relaxed max-w-3xl">
            <span className="font-semibold text-primary">FunGO</span> leverages the <span className="font-medium">ESM2-t36-3B</span> protein language model combined with <span className="font-medium">4,133 XGBoost classifiers</span> to deliver evidence-tiered Gene Ontology predictions across Molecular Function, Biological Process, and Cellular Component — providing interpretable, information-theoretically scored functional annotations for any protein sequence.
          </p>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          MAIN CONTENT
      ════════════════════════════════════════════ */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

          {/* ── Left panel ── */}
          <div className="space-y-4">

            {/* FASTA Input */}
            <div className="card">
              <div className="card-head flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Sequence Input</h2>
                  <p className="text-xs text-ink3 mt-0.5">Paste FASTA · max 10 sequences · OX= taxon auto-detected</p>
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-edge text-ink3 hover:border-primary/40 hover:text-primary transition-colors"
                >
                  Upload .fa
                </button>
                <input
                  ref={fileRef} type="file" accept=".fa,.fasta,.txt" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) { const r = new FileReader(); r.onload = ev => setFasta(ev.target?.result as string ?? ''); r.readAsText(f) }
                  }}
                />
              </div>
              <textarea
                className="seq w-full bg-white text-xs text-ink placeholder:text-ink3/50 p-4 resize-none focus:outline-none"
                rows={14}
                placeholder={`>sp|P00519|ABL1_HUMAN OS=Homo sapiens OX=9606\nMLEICLKLVGCKSKKGL…\n\nPaste one or more FASTA sequences.\nUniProt headers with OX= are auto-parsed.`}
                value={fasta}
                onChange={e => setFasta(e.target.value)}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit() }}
                spellCheck={false}
              />
              <div className="flex items-center justify-between px-4 py-2 border-t border-edge bg-surface">
                <span className="text-xs text-ink3">{seqCount > 0 ? `${seqCount} sequence${seqCount !== 1 ? 's' : ''}` : 'No sequences detected'}</span>
                <button onClick={() => setFasta(EXAMPLE)} className="text-xs text-ink3 hover:text-primary transition-colors">Load example</button>
              </div>
            </div>

            {/* Options */}
            <div className="card">
              <div className="card-head">
                <h3 className="text-xs font-semibold text-ink3 uppercase tracking-wider">Options</h3>
              </div>
              <div className="px-4 py-3 space-y-3">
                <label className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">Debug mode</p>
                    <p className="text-xs text-ink3">Show why predictions were filtered out</p>
                  </div>
                  <Toggle on={debug} set={setDebug} color="indigo" />
                </label>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={submit}
              disabled={loading || !fasta.trim() || !online}
              className={clsx(
                'w-full py-3.5 rounded-xl text-sm font-semibold transition-all',
                loading || !fasta.trim() || !online
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-edge'
                  : 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow-md'
              )}
            >
              {loading ? 'Running prediction…' : !online ? 'API offline — start Flask' : `Predict GO Terms${seqCount > 0 ? ` (${seqCount})` : ''}`}
            </button>
            <p className="text-xs text-center text-ink3 -mt-1">Ctrl+Enter to submit · ~20–60 s with embedding cache</p>

            {/* Taxonomy lookup */}
            <div className="card">
              <div className="card-head">
                <h3 className="text-sm font-semibold text-ink">Taxonomy Lookup</h3>
                <p className="text-xs text-ink3 mt-0.5">Find NCBI taxon IDs for FASTA headers</p>
              </div>
              <div className="p-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. homo sapiens, mus musculus…"
                    value={taxQ}
                    onChange={e => taxSearch(e.target.value)}
                    className="w-full bg-surface border border-edge rounded-lg px-3 py-2 text-xs text-ink placeholder:text-ink3 focus:border-primary/40"
                  />
                  {taxLoad && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-edge border-t-primary rounded-full spin" />
                  )}
                </div>
                {taxRes.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                    {taxRes.map((r, i) => (
                      <div key={i} className="p-2 rounded-lg bg-surface border border-edge text-xs">
                        {r.error ? (
                          <span className="text-red-500">{r.error}</span>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-ink">{r.scientific_name}</span>
                              <span className="font-mono text-primary font-semibold">OX={r.taxon_id}</span>
                            </div>
                            {r.common_name && <div className="text-ink3 mt-0.5">{r.common_name} · {r.rank}</div>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Evidence tier guide */}
            <div className="card">
              <div className="card-head">
                <h3 className="text-sm font-semibold text-ink">Evidence Tiers</h3>
                <p className="text-xs text-ink3 mt-0.5">Score = IA weight × confidence</p>
              </div>
              <div className="divide-y divide-edge">
                {[
                  { tier: 'STRONG'    as Tier, rule: 'IA > 5.0 · conf ≥ 0.30', desc: 'Highly specific GO term with reliable model confidence' },
                  { tier: 'MODERATE'  as Tier, rule: 'IA > 2.0 · conf ≥ 0.50', desc: 'Moderately specific term with acceptable confidence' },
                  { tier: 'INDICATIVE'as Tier, rule: 'IA > 1.0 · conf ≥ 0.65', desc: 'Lower specificity — requires high confidence to qualify' },
                ].map(({ tier, rule, desc }) => (
                  <div key={tier} className="px-4 py-3 flex items-start gap-3">
                    <TierBadge tier={tier} />
                    <div>
                      <p className="text-xs font-mono text-ink2">{rule}</p>
                      <p className="text-xs text-ink3 mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="space-y-4">

            {/* Results meta bar */}
            {(result || loading || error) && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                {result && (
                  <p className="text-sm text-ink3">
                    <span className="text-ink font-semibold">{result.metadata.total_displayed}</span> predictions shown
                    &nbsp;·&nbsp;
                    <span className="text-ink font-semibold">{result.metadata.n_proteins}</span> protein{result.metadata.n_proteins !== 1 ? 's' : ''}
                    &nbsp;·&nbsp;
                    <span className="text-primary font-semibold">{result.metadata.elapsed_seconds}s</span>
                    &nbsp;·&nbsp;{result.metadata.device}
                  </p>
                )}
              </div>
            )}

            {/* Loading */}
            {loading && <LoadingCard />}

            {/* Error */}
            {error && (
              <div className="card border-red-200">
                <div className="px-5 py-4">
                  <p className="text-sm font-semibold text-red-600">Prediction failed</p>
                  <p className="text-xs font-mono text-red-500 mt-1 break-all">{error}</p>
                </div>
              </div>
            )}

            {/* Result cards */}
            {result && Object.entries(result.predictions).map(([pid, data], i) => (
              <ProteinCard key={pid} pid={pid} data={data} jobId={result.job_id} idx={i} />
            ))}

            {/* Empty state */}
            {!loading && !error && !result && (
              <div className="card py-16 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/8 border border-primary/15 flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" stroke="#1B5FA8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-base font-semibold text-ink">Paste a FASTA sequence to begin</p>
                <p className="text-sm text-ink3 mt-2 max-w-sm mx-auto">
                  FunGO predicts GO terms across MFO, BPO, and CCO using ESM2-t36-3B embeddings and XGBoost classifiers with evidence-tiered quality filtering.
                </p>
                <div className="flex justify-center gap-2 mt-5">
                  {['MFO','BPO','CCO'].map(o => (
                    <span key={o} className={clsx('text-xs px-2.5 py-1 rounded-full', ONT[o].pill)}>
                      <span className="w-1.5 h-1.5 rounded-full inline-block mr-1.5" style={{ background: ONT[o].dot }} />
                      {ONT[o].label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════ */}
      <footer className="border-t border-edge bg-surface mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">

          {/* Developer team */}
          <div className="mb-8">
            <p className="text-xs font-semibold text-ink3 uppercase tracking-wider mb-5">Development Team</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {TEAM.map(dev => (
                <div key={dev.name} className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: dev.color }}
                  >
                    {dev.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{dev.name}</p>
                    <p className="text-xs text-primary font-medium">{dev.role}</p>
                    <p className="text-xs text-ink3">{dev.title}</p>
                    <p className="text-xs text-ink3">{dev.dept}</p>
                    <p className="text-xs text-ink3">{dev.uni}</p>
                    {dev.email && (
                      <a href={`mailto:${dev.email}`} className="text-xs text-primary hover:underline mt-0.5 block">
                        {dev.email}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hr mb-5" />

          {/* Bottom bar */}
          <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-ink3">
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="FunGO" width={72} height={30} className="object-contain opacity-70" />
              <span>School of Biochemistry and Biotechnology · University of the Punjab, Lahore</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="https://amigo.geneontology.org" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">AmiGO Browser</a>
              <span>ESM2-t36-3B · XGBoost · {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
