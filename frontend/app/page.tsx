'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'

/* ── types ── */
interface Pred { go_term:string; ontology:string; confidence:number; ia_weight:number; tier:'GOLD'|'GOOD'|'SILVER'; tier_label:string; ontology_label:string; threshold:number }
interface FOut { go_term:string; ontology:string; confidence:number; ia_weight:number; reason:string }
interface PSummary { protein_id:string; total_predictions:number; by_ontology:{MFO:number;BPO:number;CCO:number}; by_tier:{GOLD:number;GOOD:number;SILVER:number}; has_gold:boolean; avg_confidence:number; avg_ia:number }
interface PResult { taxon_id:number|null; summary:PSummary; filtered:Pred[]; filtered_out?:FOut[]; raw?:Pred[] }
interface PredResp { metadata:{n_proteins:number;device:string;total_raw_predictions:number;total_filtered_predictions:number;elapsed_seconds:number}; predictions:Record<string,PResult> }
interface ModelInfo { device:string; fp16:boolean; ontologies:{MFO:number;BPO:number;CCO:number}; thresholds:Record<string,{min_ia:number;min_conf:number}> }

/* ── constants ── */
const EXAMPLE = `>sp|P00519|ABL1_HUMAN Tyrosine-protein kinase ABL1 OS=Homo sapiens OX=9606
MLEICLKLVGCKSKKGLSSSSSCYLEEALQRPVASDFEPQGLSEAARWNSKENLLAGPSENDPNLFVALYDFVASGDNTLSITKGEKLRVLGYNHNGEWCEAQTKNGQGWVPSNYITPVNSLEKHSWYHGPVSRNAAEYLLSSGINGSFLVRESESSPGQRSISLRYEGRVYHYRINTASDGKLYVSSESRFNTLAELVHHHSTVADGLITTLHYPAPKRNKPTVYGVSPNYDKWEMERTDITMKHKLGGGQYGEVYEGVWKKYSLTVAVKTLKEDTMEVEEFLKEAAVMKEIKHPNLVQLLGVCTREPPFYIITEFMTYGNLLDYLRECNRQEVNAVVLLYMATQISSAMEYLEKKNFIHRDLAARNCLVGENHLVKVADFGLSRLMTGDTYTAHAGAKFPIKWTAPESLAYNKFSIKSDK`

const ONT:Record<string,string> = { MFO:'text-purple-400 bg-purple-900/30 border-purple-700/30', BPO:'text-teal-400 bg-teal-900/30 border-teal-700/30', CCO:'text-amber-400 bg-amber-900/30 border-amber-700/30' }
const TIER:Record<string,{cls:string;dot:string}> = {
  GOLD:{cls:'text-amber-400 bg-amber-900/30 border-amber-600/40 tier-gold',dot:'#f59e0b'},
  GOOD:{cls:'text-blue-400 bg-blue-900/30 border-blue-600/40 tier-good',dot:'#60a5fa'},
  SILVER:{cls:'text-slate-400 bg-slate-800/40 border-slate-600/30',dot:'#94a3b8'},
}

/* ── small atoms ── */
function Dot({on}:{on:boolean|null}){
  if(on===null) return <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse inline-block"/>
  return <span className={clsx('w-2 h-2 rounded-full inline-block',on?'bg-emerald-400':'bg-red-500')}/>
}
function TBadge({tier}:{tier:string}){
  const t=TIER[tier]??TIER.SILVER
  return <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',t.cls)}><span className="w-1.5 h-1.5 rounded-full" style={{background:t.dot}}/>{tier[0]+tier.slice(1).toLowerCase()}</span>
}
function OBadge({ont}:{ont:string}){
  return <span className={clsx('inline-block px-1.5 py-0.5 rounded text-xs font-mono border',ONT[ont]??'text-slate-400 bg-slate-800/40 border-slate-600/30')}>{ont}</span>
}
function CBar({v}:{v:number}){
  const p=Math.round(v*100), c=v>=.8?'#22d3a0':v>=.6?'#60a5fa':'#94a3b8'
  return <div className="flex items-center gap-2"><div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full" style={{width:p+'%',background:c}}/></div><span className="text-xs font-mono" style={{color:c}}>{p}%</span></div>
}
function Spinner(){return <div className="w-3 h-3 border border-slate-600 border-t-emerald-400 rounded-full animate-spin"/>}

/* ── protein card ── */
function PCard({pid,res,dbg,idx}:{pid:string;res:PResult;dbg:boolean;idx:number}){
  const [open,setOpen]=useState(false)
  const {summary:s,filtered:f,filtered_out:fo}=res
  return(
    <div className="rounded-xl border border-[#162240] bg-[#0d1529] overflow-hidden slide-in" style={{animationDelay:idx*.07+'s'}}>
      {/* header */}
      <div className="flex items-start justify-between gap-4 p-4 border-b border-[#162240]">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium text-[#22d3a0]">{pid}</span>
            {res.taxon_id&&<span className="text-xs text-[#4a6888] font-mono">OX={res.taxon_id}</span>}
            {s.has_gold&&<span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-700/30">✦ Gold</span>}
          </div>
          <p className="text-xs text-[#4a6888] mt-1">{s.total_predictions} predictions · avg conf {Math.round(s.avg_confidence*100)}% · avg IA {s.avg_ia.toFixed(2)}</p>
        </div>
        <div className="flex gap-3 shrink-0">
          {(['MFO','BPO','CCO'] as const).map(o=>(
            <div key={o} className="text-center">
              <div className="text-lg font-semibold leading-none" style={{color:o==='MFO'?'#c084fc':o==='BPO'?'#2dd4bf':'#fbbf24'}}>{s.by_ontology[o]}</div>
              <div className="text-xs text-[#4a6888] mt-0.5">{o}</div>
            </div>
          ))}
        </div>
      </div>
      {/* tier pills */}
      <div className="flex gap-2 px-4 py-2.5 border-b border-[#162240] bg-[#080e1a]/50 flex-wrap">
        {(['GOLD','GOOD','SILVER'] as const).map(t=>(
          <div key={t} className="flex items-center gap-1.5"><TBadge tier={t}/><span className="text-xs text-[#4a6888]">{s.by_tier[t]}</span></div>
        ))}
        <span className="ml-auto text-xs text-[#4a6888]">{f.length===0?'No filtered predictions':`${f.length} accepted`}</span>
      </div>
      {/* table */}
      {f.length>0?(
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[#162240] bg-[#080e1a]/30">
              {['GO Term','Ontology','Tier','Confidence','IA Weight'].map(h=><th key={h} className="text-left px-4 py-2 text-[#4a6888] font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{f.map((p,i)=>(
              <tr key={i} className="pred-row border-b border-[#162240]/50 transition-colors">
                <td className="px-4 py-2"><a href={`https://amigo.geneontology.org/amigo/term/${p.go_term}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#22d3a0] hover:underline">{p.go_term}</a></td>
                <td className="px-4 py-2"><OBadge ont={p.ontology}/></td>
                <td className="px-4 py-2"><TBadge tier={p.tier}/></td>
                <td className="px-4 py-2"><CBar v={p.confidence}/></td>
                <td className="px-4 py-2 font-mono text-[#4a6888]">{p.ia_weight.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ):(
        <div className="px-4 py-8 text-center text-xs text-[#4a6888]">No predictions passed filter.{dbg&&<> Enable debug to see why.</>}</div>
      )}
      {/* debug */}
      {dbg&&fo&&fo.length>0&&(
        <div className="border-t border-[#162240]">
          <button onClick={()=>setOpen(v=>!v)} className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-[#4a6888] hover:text-[#c4d8f0] transition-colors bg-[#080e1a]/30">
            <span><span className="text-red-400/60 mr-1">⬡</span>{fo.length} rejected</span>
            <span>{open?'▲':'▼'}</span>
          </button>
          {open&&(
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-[#162240] bg-red-950/20">
                  {['GO Term','Ont','IA','Conf','Reason'].map(h=><th key={h} className="text-left px-4 py-2 text-red-400/50 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>{fo.map((r,i)=>(
                  <tr key={i} className="border-b border-[#162240]/30 opacity-70">
                    <td className="px-4 py-1.5 font-mono text-slate-400">{r.go_term}</td>
                    <td className="px-4 py-1.5"><OBadge ont={r.ontology}/></td>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{r.ia_weight.toFixed(4)}</td>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{(r.confidence*100).toFixed(1)}%</td>
                    <td className="px-4 py-1.5 text-red-400/60">{r.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── main ── */
export default function Page(){
  const [fasta,setFasta]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [results,setResults]=useState<PredResp|null>(null)
  const [info,setInfo]=useState<ModelInfo|null>(null)
  const [online,setOnline]=useState<boolean|null>(null)
  const [filter,setFilter]=useState(true)
  const [debug,setDebug]=useState(false)
  const [taxQ,setTaxQ]=useState('')
  const [taxR,setTaxR]=useState<any[]>([])
  const [taxL,setTaxL]=useState(false)
  const fileRef=useRef<HTMLInputElement>(null)
  const taxTimer=useRef<ReturnType<typeof setTimeout>|null>(null)

  useEffect(()=>{
    fetch('/api/health').then(r=>r.ok?r.json():null)
      .then(d=>{setOnline(!!d?.status);if(d?.status)fetch('/api/model/info').then(r=>r.json()).then(setInfo).catch(()=>{})})
      .catch(()=>setOnline(false))
  },[])

  const taxSearch=(q:string)=>{
    setTaxQ(q)
    if(taxTimer.current)clearTimeout(taxTimer.current)
    if(q.trim().length<2){setTaxR([]);return}
    taxTimer.current=setTimeout(async()=>{
      setTaxL(true)
      try{const r=await fetch(`/api/taxonomy/search?q=${encodeURIComponent(q)}`);const d=await r.json();setTaxR(d.results??[])}
      catch{setTaxR([])}finally{setTaxL(false)}
    },400)
  }

  const submit=useCallback(async()=>{
    if(!fasta.trim())return
    setLoading(true);setError(null);setResults(null)
    try{
      const r=await fetch(debug?'/api/predict/debug':'/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fasta,filter})})
      const d=await r.json()
      if(!r.ok)throw new Error(d.error??`HTTP ${r.status}`)
      setResults(d)
    }catch(e:unknown){setError(e instanceof Error?e.message:String(e))}
    finally{setLoading(false)}
  },[fasta,filter,debug])

  const seqs=(fasta.match(/^>/gm)??[]).length

  const dlJSON=()=>{if(!results)return;const b=new Blob([JSON.stringify(results,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='fungo_results.json';a.click()}
  const dlTSV=()=>{
    if(!results)return
    const rows=['protein_id\tgo_term\tontology\ttier\tconfidence\tia_weight']
    for(const[pid,d]of Object.entries(results.predictions))for(const p of d.filtered)rows.push(`${pid}\t${p.go_term}\t${p.ontology}\t${p.tier}\t${p.confidence}\t${p.ia_weight}`)
    const b=new Blob([rows.join('\n')],{type:'text/tab-separated-values'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='fungo_results.tsv';a.click()
  }

  function Toggle({on,set,accent='accent'}:{on:boolean;set:(v:boolean)=>void;accent?:string}){
    const c=accent==='purple'?'bg-purple-400/20 border-purple-400/50':'bg-[#22d3a0]/20 border-[#22d3a0]/50'
    const d=accent==='purple'?'bg-purple-400':'bg-[#22d3a0]'
    return(
      <div onClick={()=>set(!on)} className={clsx('relative rounded-full border cursor-pointer transition-all',on?c:'bg-[#080e1a] border-[#162240]')} style={{width:40,height:22}}>
        <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full transition-transform',on?`translate-x-5 ${d}`:'translate-x-0.5 bg-[#4a6888]')} style={{margin:1}}/>
      </div>
    )
  }

  return(
    <div className="min-h-screen bg-[#04080f]">
      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-[#162240] bg-[#080e1a]/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="13" stroke="#22d3a0" strokeWidth="1.5" strokeOpacity=".5"/>
              <path d="M7 14Q10 8 14 14Q18 20 21 14" stroke="#22d3a0" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <circle cx="14" cy="14" r="2.5" fill="#22d3a0" fillOpacity=".7"/>
            </svg>
            <span className="text-base font-semibold">Fun<span className="text-[#22d3a0]">GO</span></span>
            <span className="hidden sm:block text-xs text-[#4a6888] border border-[#162240] rounded px-1.5 py-0.5">Protein Function Prediction</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-[#4a6888]">
              <Dot on={online}/>
              {online===null?'Connecting…':online?`Online · ${info?.device??'…'}`:'Offline — start Flask'}
            </div>
            {info&&<span className="hidden md:block text-xs text-[#4a6888] border border-[#162240] rounded px-1.5 py-0.5">MFO {info.ontologies.MFO?.toLocaleString()} · BPO {info.ontologies.BPO?.toLocaleString()} · CCO {info.ontologies.CCO?.toLocaleString()}</span>}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">

          {/* left panel */}
          <div className="space-y-4">
            {/* FASTA input */}
            <div className="rounded-xl border border-[#162240] bg-[#0d1529] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#162240]">
                <div><h2 className="text-sm font-semibold">Sequence input</h2><p className="text-xs text-[#4a6888] mt-0.5">Paste FASTA · max 10 sequences</p></div>
                <button onClick={()=>fileRef.current?.click()} className="text-xs px-2.5 py-1.5 rounded-md border border-[#162240] text-[#4a6888] hover:text-[#c4d8f0] hover:border-[#22d3a0]/40 transition-colors">Upload .fa</button>
                <input ref={fileRef} type="file" accept=".fa,.fasta,.txt" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=ev=>setFasta(ev.target?.result as string??'');r.readAsText(f)}}}/>
              </div>
              <textarea className="seq w-full bg-transparent text-xs text-[#c4d8f0] placeholder:text-[#4a6888]/60 p-4 resize-none focus:outline-none" rows={14}
                placeholder={">sp|P00519|ABL1_HUMAN OS=Homo sapiens OX=9606\nMLEICLKLVGCKSKK…\n\nPaste one or more FASTA sequences.\nOX= taxon IDs extracted automatically."}
                value={fasta} onChange={e=>setFasta(e.target.value)}
                onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')submit()}} spellCheck={false}/>
              <div className="flex items-center justify-between px-4 py-2 border-t border-[#162240] bg-[#080e1a]/40">
                <span className="text-xs text-[#4a6888]">{seqs>0?`${seqs} sequence${seqs!==1?'s':''}`:'No sequences'}</span>
                <button onClick={()=>setFasta(EXAMPLE)} className="text-xs text-[#4a6888] hover:text-[#22d3a0] transition-colors">Load example</button>
              </div>
            </div>

            {/* options */}
            <div className="rounded-xl border border-[#162240] bg-[#0d1529] px-4 py-3 space-y-3">
              <h3 className="text-xs font-semibold text-[#4a6888] uppercase tracking-wider">Options</h3>
              <label className="flex items-center justify-between">
                <div><p className="text-sm">Tier filter</p><p className="text-xs text-[#4a6888]">Remove generic GO terms and low-IA predictions</p></div>
                <Toggle on={filter} set={setFilter}/>
              </label>
              <div className="h-px bg-[#162240]"/>
              <label className="flex items-center justify-between">
                <div><p className="text-sm">Debug mode</p><p className="text-xs text-[#4a6888]">Show rejected predictions and filter reasons</p></div>
                <Toggle on={debug} set={setDebug} accent="purple"/>
              </label>
            </div>

            {/* submit */}
            <button onClick={submit} disabled={loading||!fasta.trim()||!online}
              className={clsx('w-full rounded-xl py-3.5 text-sm font-semibold transition-all',
                loading||!fasta.trim()||!online
                  ?'bg-[#162240] text-[#4a6888] cursor-not-allowed'
                  :'bg-[#22d3a0]/10 hover:bg-[#22d3a0]/20 text-[#22d3a0] border border-[#22d3a0]/40 hover:border-[#22d3a0]/70')}>
              {loading?'Running…':!online?'API offline':seqs>0?`Predict GO terms (${seqs})`:'Predict GO terms'}
            </button>
            <p className="text-xs text-center text-[#4a6888] -mt-1">Ctrl+Enter · First run ~10 min (embedding)</p>

            {/* taxonomy */}
            <div className="rounded-xl border border-[#162240] bg-[#0d1529] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#162240]">
                <h3 className="text-sm font-semibold">Taxonomy lookup</h3>
                <p className="text-xs text-[#4a6888] mt-0.5">Find NCBI taxon IDs</p>
              </div>
              <div className="p-3">
                <div className="relative">
                  <input type="text" placeholder="e.g. homo sapiens…" value={taxQ} onChange={e=>taxSearch(e.target.value)}
                    className="w-full bg-[#080e1a] border border-[#162240] rounded-lg px-3 py-2 text-xs text-[#c4d8f0] placeholder:text-[#4a6888]"/>
                  {taxL&&<div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner/></div>}
                </div>
                {taxR.length>0&&(
                  <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto">
                    {taxR.map((r,i)=>(
                      <div key={i} className="p-2 rounded-lg bg-[#080e1a] border border-[#162240] text-xs">
                        {r.error?<span className="text-red-400">{r.error}</span>:(<>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-[#c4d8f0]">{r.scientific_name}</span>
                            <span className="font-mono text-[#22d3a0] shrink-0">OX={r.taxon_id}</span>
                          </div>
                          {r.common_name&&<div className="text-[#4a6888] mt-0.5">{r.common_name} · {r.rank}</div>}
                        </>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* right panel */}
          <div className="space-y-4">
            {/* result meta bar */}
            {(results||loading||error)&&(
              <div className="flex items-center justify-between flex-wrap gap-2">
                {results&&<p className="text-sm text-[#4a6888]"><span className="text-[#c4d8f0] font-medium">{results.metadata.total_filtered_predictions}</span> predictions · <span className="text-[#c4d8f0] font-medium">{results.metadata.n_proteins}</span> protein{results.metadata.n_proteins!==1?'s':''} · <span className="text-[#22d3a0]">{results.metadata.elapsed_seconds}s</span> · {results.metadata.device}</p>}
                {results&&<div className="flex gap-2">
                  <button onClick={dlTSV} className="text-xs px-3 py-1.5 rounded-lg border border-[#162240] text-[#4a6888] hover:text-[#c4d8f0] hover:border-[#22d3a0]/40 transition-colors">TSV</button>
                  <button onClick={dlJSON} className="text-xs px-3 py-1.5 rounded-lg border border-[#162240] text-[#4a6888] hover:text-[#c4d8f0] hover:border-[#22d3a0]/40 transition-colors">JSON</button>
                </div>}
              </div>
            )}

            {/* loading */}
            {loading&&(
              <div className="rounded-xl border border-[#162240] bg-[#0d1529] py-20 flex flex-col items-center gap-6">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border border-[#22d3a0]/30 pulse-ring"/>
                  <div className="absolute inset-0 rounded-full border border-[#22d3a0]/20 pulse-ring" style={{animationDelay:'.4s'}}/>
                  <div className="w-16 h-16 rounded-full border border-[#22d3a0]/50 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-[#22d3a0]/20 animate-pulse"/>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#22d3a0]">Running inference</p>
                  <p className="text-xs text-[#4a6888] mt-1">ESM2 embedding + XGBoost · 20–60 s with cache</p>
                </div>
                <div className="w-48 h-0.5 bg-[#162240] rounded overflow-hidden relative">
                  <div className="absolute inset-0 scan-line bg-gradient-to-r from-transparent via-[#22d3a0]/50 to-transparent"/>
                </div>
              </div>
            )}

            {/* error */}
            {error&&<div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4"><p className="text-sm font-medium text-red-400">Prediction failed</p><p className="text-xs text-red-400/60 mt-1 font-mono break-all">{error}</p></div>}

            {/* cards */}
            {results&&Object.entries(results.predictions).map(([pid,data],i)=><PCard key={pid} pid={pid} res={data} dbg={debug} idx={i}/>)}

            {/* empty state */}
            {!loading&&!error&&!results&&(
              <div className="rounded-xl border border-[#162240] bg-[#0d1529]/50 p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#22d3a0]/5 border border-[#22d3a0]/20 flex items-center justify-center mx-auto">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2v16M2 10h16M5 5l10 10M15 5L5 15" stroke="#22d3a0" strokeWidth="1.2" strokeLinecap="round" strokeOpacity=".6"/></svg>
                </div>
                <p className="text-sm font-medium">Paste a FASTA sequence to begin</p>
                <p className="text-xs text-[#4a6888] max-w-xs mx-auto">Predicts MFO, BPO and CCO GO terms using ESM2-3B embeddings and XGBoost classifiers with tier-based quality filtering.</p>
                <div className="flex justify-center gap-3 pt-1">
                  {['MFO','BPO','CCO'].map(o=><span key={o} className={clsx('text-xs px-2 py-1 rounded border',ONT[o])}>{o}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#162240] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-[#4a6888]">
          <span>FunGO · ESM2-3B + XGBoost</span>
          <a href="https://amigo.geneontology.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#c4d8f0] transition-colors">AmiGO →</a>
        </div>
      </footer>
    </div>
  )
}
