'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import clsx from 'clsx'

type Tier = 'STRONG' | 'MODERATE' | 'INDICATIVE'
interface Pred { go_term:string; ontology:string; ontology_label:string; confidence:number; ia_weight:number; combined_score:number; tier:Tier; tier_label:string; threshold:number }
interface Summary { protein_id:string; total_filtered:number; displayed:number; by_ontology:{MFO:number;BPO:number;CCO:number}; by_tier:{STRONG:number;MODERATE:number;INDICATIVE:number}; has_strong_evidence:boolean; avg_combined_score:number }
interface ProteinResult { taxon_id:number|null; summary:Summary; display:Pred[]; total_all:number }
interface PredResponse { job_id:string; metadata:{n_proteins:number;device:string;total_displayed:number;elapsed_seconds:number}; predictions:Record<string,ProteinResult> }

const EXAMPLE_FASTA = `>sp|Q7L266|ASGL1_HUMAN Isoaspartyl peptidase OS=Homo sapiens OX=9606 GN=ASRGL1 PE=1 SV=2
MNPIVVVHGGGAGPISKDRKERVHQGMVRAATVGYGILREGGSAVDAVEGAVVALEDDPE
FNAGCGSVLNTNGEVEMDASIMDGKDLSAGAVSAVQCIANPIKLARLVMEKTPHCFLTDQ
GAAQFAAAAMGVPEIPGEKLVTERNKKRLEKEKHEKGAQKTDCQKNLGTVGAVALDCKGNV
AYATSTGGIVNKMVGRVGDSPCLGAGGYADNDIGAVSTTGHGESILKVNLARLTLFHIEQ
GKTVEEAADLSLGYMKSRVKGLGGLIVVSKTGDWVAKWTSTSMPWAAAKDGKLHFGIDPD
DTTITDLP`

const ONT: Record<string,{pill:string;dot:string;label:string}> = {
  MFO:{pill:'bg-purple-50 text-purple-700 border border-purple-200',dot:'#7c3aed',label:'Molecular Function'},
  BPO:{pill:'bg-teal-50 text-teal-700 border border-teal-200',dot:'#0d9488',label:'Biological Process'},
  CCO:{pill:'bg-amber-50 text-amber-700 border border-amber-200',dot:'#d97706',label:'Cellular Component'},
}
const TIER_CFG: Record<Tier,{bg:string;text:string;border:string;dot:string}> = {
  STRONG:    {bg:'bg-amber-50', text:'text-amber-800',border:'border-amber-300',dot:'#d97706'},
  MODERATE:  {bg:'bg-blue-50',  text:'text-blue-800', border:'border-blue-200', dot:'#1B5FA8'},
  INDICATIVE:{bg:'bg-gray-50',  text:'text-gray-700', border:'border-gray-300', dot:'#6b7280'},
}
const TEAM = [
  {name:'Muteeba Azhar',      title:'MS Researcher',      dept:'School of Biochemistry and Biotechnology',uni:'University of the Punjab, Lahore',email:'muteebaazhar18@gmail.com',initials:'MA',color:'#6366f1'},
  {name:'Dr. Naeem Mahmood',  title:'Assistant Professor',dept:'School of Biochemistry and Biotechnology',uni:'University of the Punjab, Lahore',email:'naeem.sbb@pu.edu.pk',   initials:'NM',color:'#028090'},
  {name:'Dr. Beenish Maqsood',title:'Assistant Professor',dept:'School of Biochemistry and Biotechnology',uni:'University of the Punjab, Lahore',email:'beenish.ibb@pu.edu.pk',initials:'BM',color:'#1B5FA8'},
]

function StatusDot({online}:{online:boolean|null}) {
  if(online===null) return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block animate-pulse"/>
  return <span className={clsx('w-2 h-2 rounded-full inline-block',online?'bg-green-500':'bg-red-400')}/>
}
function TierBadge({tier}:{tier:Tier}) {
  const c=TIER_CFG[tier]; const label=tier==='STRONG'?'Strong Evidence':tier==='MODERATE'?'Moderate Evidence':'Indicative'
  return <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',c.bg,c.text,c.border)}><span className="w-1.5 h-1.5 rounded-full" style={{background:c.dot}}/>{label}</span>
}
function OntBadge({ont}:{ont:string}) {
  const o=ONT[ont]??{pill:'bg-gray-50 text-gray-600 border border-gray-200',dot:'#6b7280',label:ont}
  return <span className={clsx('inline-block px-2 py-0.5 rounded text-xs font-mono font-medium',o.pill)}>{ont}</span>
}
function ConfBar({v}:{v:number}) {
  const pct=Math.round(v*100); const color=v>=0.8?'#059669':v>=0.65?'#1B5FA8':v>=0.5?'#d97706':'#ef4444'
  return <div className="flex items-center gap-2"><div className="w-16 h-1.5 rounded-full bg-gray-100 border border-gray-200 overflow-hidden"><div className="h-full rounded-full" style={{width:`${pct}%`,background:color}}/></div><span className="text-xs font-mono font-semibold w-8" style={{color}}>{pct}%</span></div>
}
function Collapsible({title,icon,children}:{title:string;icon:React.ReactNode;children:React.ReactNode}) {
  const [open,setOpen]=useState(false)
  return <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
    <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
      <div className="flex items-center gap-2.5">{icon}<span className="text-sm font-semibold text-gray-800">{title}</span></div>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={clsx('transition-transform text-gray-400',open&&'rotate-180')}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open&&<div className="border-t border-gray-100">{children}</div>}
  </div>
}

function ProteinCard({pid,data,jobId}:{pid:string;data:ProteinResult;jobId:string}) {
  const {summary:s,display,total_all}=data
  return <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
    <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-bold text-blue-700">{pid}</span>
          {data.taxon_id&&<span className="text-xs text-gray-500 font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200">OX={data.taxon_id}</span>}
          {s.has_strong_evidence&&<span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">Strong Evidence hits</span>}
        </div>
        <p className="text-xs text-gray-500 mt-1">{s.displayed} predictions shown · {total_all} total filtered · avg score {s.avg_combined_score.toFixed(3)}</p>
      </div>
      <div className="flex items-center gap-4">
        {(['MFO','BPO','CCO'] as const).map(o=><div key={o} className="text-center"><div className="text-base font-bold leading-none" style={{color:ONT[o].dot}}>{s.by_ontology[o]}</div><div className="text-xs text-gray-400 mt-0.5">{o}</div></div>)}
      </div>
    </div>
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 flex-wrap">
      {(['STRONG','MODERATE','INDICATIVE'] as Tier[]).map(t=><div key={t} className="flex items-center gap-1.5"><TierBadge tier={t}/><span className="text-xs text-gray-500 font-medium">{s.by_tier[t]}</span></div>)}
      <div className="ml-auto flex items-center gap-2">
        {total_all>20&&<span className="text-xs text-gray-400">+{total_all-20} more in CSV</span>}
        <button onClick={()=>window.open(`/api/predict/csv?job_id=${jobId}`,'_blank')} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3.5 5.5L6 8l2.5-2.5M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          Download CSV
        </button>
      </div>
    </div>
    {display.length>0?<div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="border-b border-gray-100 bg-gray-50">
        <th className="text-left px-5 py-2.5 text-gray-500 font-semibold">GO Term</th>
        <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Category</th>
        <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">
          <span className="flex items-center gap-1">Evidence
            <span className="group relative cursor-default">
              <span className="text-gray-400 text-xs">ⓘ</span>
              <span className="invisible group-hover:visible absolute left-0 top-5 z-10 w-56 p-2.5 bg-gray-900 text-white text-xs rounded-lg leading-relaxed shadow-lg">
                Tier is based on GO term specificity (IA weight). Score = IA weight × confidence. Both values are shown so you can evaluate independently.
              </span>
            </span>
          </span>
        </th>
        <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Confidence</th>
        <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">IA Weight</th>
        <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Score</th>
      </tr></thead>
      <tbody>{display.map((p,i)=><tr key={i} className={clsx('border-b border-gray-100 hover:bg-blue-50 transition-colors',i%2===0?'bg-white':'bg-gray-50/40')}>
        <td className="px-5 py-2.5"><a href={`https://amigo.geneontology.org/amigo/term/${p.go_term}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline font-semibold">{p.go_term}</a><div className="text-gray-400 text-xs mt-0.5">{p.ontology_label}</div></td>
        <td className="px-3 py-2.5"><OntBadge ont={p.ontology}/></td>
        <td className="px-3 py-2.5"><TierBadge tier={p.tier}/></td>
        <td className="px-3 py-2.5"><ConfBar v={p.confidence}/></td>
        <td className="px-3 py-2.5 font-mono text-gray-600">{p.ia_weight.toFixed(4)}</td>
        <td className="px-3 py-2.5 font-mono font-bold text-gray-800">{p.combined_score.toFixed(4)}</td>
      </tr>)}</tbody>
    </table></div>:
    <div className="px-5 py-10 text-center"><p className="text-sm text-gray-500">No predictions passed the evidence filter.</p><p className="text-xs text-gray-400 mt-1">Try a longer sequence or check the FASTA format.</p></div>}
  </div>
}

export default function Page() {
  const [fasta,  setFasta]  = useState('')
  const [loading,setLoading]= useState(false)
  const [error,  setError]  = useState<string|null>(null)
  const [result, setResult] = useState<PredResponse|null>(null)
  const [online, setOnline] = useState<boolean|null>(null)
  const [taxQ,   setTaxQ]   = useState('')
  const [taxRes, setTaxRes] = useState<any[]>([])
  const [taxLoad,setTaxLoad]= useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const taxTimer= useRef<ReturnType<typeof setTimeout>|null>(null)

  useState(()=>{
    fetch('/api/health').then(r=>r.ok?r.json():null).then(d=>setOnline(!!d?.status)).catch(()=>setOnline(false))
  })

  const taxSearch=(q:string)=>{
    setTaxQ(q); if(taxTimer.current) clearTimeout(taxTimer.current)
    if(q.trim().length<2){setTaxRes([]);return}
    taxTimer.current=setTimeout(async()=>{
      setTaxLoad(true)
      try{const r=await fetch(`/api/taxonomy/search?q=${encodeURIComponent(q)}`);const d=await r.json();setTaxRes(d.results??[])}catch{setTaxRes([])}finally{setTaxLoad(false)}
    },400)
  }

  const submit=useCallback(async()=>{
    if(!fasta.trim()) return
    setLoading(true);setError(null);setResult(null)
    try{
      const r=await fetch('/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fasta})})
      const d=await r.json(); if(!r.ok) throw new Error(d.error??`HTTP ${r.status}`); setResult(d)
    }catch(e:unknown){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}
  },[fasta])

  const seqCount=(fasta.match(/^>/gm)??[]).length

  return <div className="min-h-screen bg-white flex flex-col" style={{fontFamily:'var(--font-plus),sans-serif'}}>

    {/* NAVBAR */}
<<<<<<< HEAD
    <header className="sticky top-0 z-40 bg-white" style={{boxShadow:'0 1px 0 #e5e7eb'}}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[72px] flex items-center gap-6">
        <Image src="/logo.png" alt="FunGO" width={145} height={60} className="object-contain shrink-0" priority/>
        <div className="hidden sm:block w-px h-8 bg-gray-200 shrink-0"/>
        <div className="flex-1 hidden sm:block">
          <p className="text-xs font-medium" style={{color:'#1B5FA8'}}>Beyond Prediction — Understanding Function</p>
          <p className="text-xs mt-0.5 leading-relaxed" style={{color:'#64748b'}}>FunGO predicts Molecular Function, Biological Process, and Cellular Component GO annotations from protein sequences using ESM2 + XGBoost multi-label modeling.</p>
        </div>
        <div className="ml-auto shrink-0">
        {online===false&&(
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{color:'#dc2626',background:'#fef2f2',border:'1px solid #fecaca'}}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#ef4444'}}/>
            API offline
          </div>
        )}
        {online===true&&(
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{color:'#16a34a',background:'#f0fdf4',border:'1px solid #bbf7d0'}}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#22c55e'}}/>
            API ready
          </div>
        )}
=======
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-4">
        <Image src="/logo.png" alt="FunGO" width={155} height={65} className="object-contain" priority/>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <StatusDot online={online}/>
          <span>{online===null?'Connecting…':online?'API ready':'API offline'}</span>
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
        </div>
      </div>
    </header>

    {/* HERO */}
<<<<<<< HEAD
    <div style={{background:'linear-gradient(135deg,#f0f7ff 0%,#e8f5f5 50%,#f5f0ff 100%)',borderBottom:'1px solid #e5e7eb'}}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold mb-2" style={{color:'#0f172a'}}>Decoding Protein Function from Sequence</h1>
        <p className="text-sm max-w-3xl leading-relaxed mb-5" style={{color:'#475569'}}>FunGO is designed to infer protein function directly from amino acid sequences. It predicts Gene Ontology (GO) annotations across Molecular Function, Biological Process and Cellular Component, providing a comprehensive functional profile of proteins.</p>
        <div className="flex items-center gap-2 flex-wrap">
          {[{s:'1',l:'Paste FASTA sequence',c:'#1B5FA8'},{s:'2',l:'Run prediction',c:'#028090'},{s:'3',l:'Explore GO annotations',c:'#6366f1'}].map((item,i)=><div key={i} className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5" style={{boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
              <span className="w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{background:item.c}}>{item.s}</span>
              <span className="text-xs font-medium" style={{color:'#334155'}}>{item.l}</span>
            </div>
            {i<2&&<span style={{color:'#94a3b8',fontSize:14}}>→</span>}
=======
    <div className="bg-gradient-to-r from-blue-50 to-teal-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Decoding Protein Function from Sequence</h1>
        <p className="text-sm text-gray-600 max-w-3xl leading-relaxed">Predict Molecular Function, Biological Process, and Cellular Component annotations directly from protein sequences using multi-label Gene Ontology modeling.</p>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {[{s:'1',l:'Paste FASTA sequence'},{s:'2',l:'Run prediction'},{s:'3',l:'Explore GO annotations'}].map((item,i)=><div key={i} className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-sm">
              <span className="w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">{item.s}</span>
              <span className="text-xs font-medium text-gray-700">{item.l}</span>
            </div>
            {i<2&&<span className="text-gray-300">→</span>}
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
          </div>)}
        </div>
      </div>
    </div>

    {/* MAIN */}
    <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">

        {/* Left */}
        <div className="space-y-4">
          {/* Input */}
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div><h2 className="text-sm font-semibold text-gray-800">Sequence Input</h2><p className="text-xs text-gray-500 mt-0.5">FASTA format · max 10 sequences</p></div>
              <button onClick={()=>fileRef.current?.click()} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors">Upload .fa</button>
              <input ref={fileRef} type="file" accept=".fa,.fasta,.txt" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=ev=>setFasta(ev.target?.result as string??'');r.readAsText(f)}}}/>
            </div>
            <textarea className="w-full bg-white text-xs text-gray-800 placeholder:text-gray-400 p-4 resize-none focus:outline-none" style={{fontFamily:'var(--font-jb),monospace'}} rows={12}
              placeholder={`>sp|P00519|ABL1_HUMAN OS=Homo sapiens OX=9606\nMLEICLKLVGCKSKKGL…\n\nPaste one or more FASTA sequences.`}
              value={fasta} onChange={e=>setFasta(e.target.value)}
              onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter') submit()}} spellCheck={false}/>
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
              <span className="text-xs text-gray-500">{seqCount>0?`${seqCount} sequence${seqCount!==1?'s':''}`:'No sequences'}</span>
              <button onClick={()=>setFasta(EXAMPLE_FASTA)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Try sample</button>
            </div>
          </div>

          {/* Submit */}
          <button onClick={submit} disabled={loading||!fasta.trim()||!online}
<<<<<<< HEAD
            className={clsx('w-full py-3.5 rounded-xl text-sm font-bold transition-all',loading||!fasta.trim()||!online?'bg-gray-100 text-gray-400 cursor-not-allowed':'')}
            style={(!loading&&fasta.trim()&&online)?{background:'linear-gradient(135deg,#1B5FA8,#028090)',color:'white',boxShadow:'0 4px 14px rgba(27,95,168,0.25)'}:{}}>
=======
            className={clsx('w-full py-3.5 rounded-xl text-sm font-bold transition-all',loading||!fasta.trim()||!online?'bg-gray-100 text-gray-400 cursor-not-allowed':'bg-blue-700 text-white hover:bg-blue-800 shadow-sm hover:shadow-md')}>
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
            {loading?'Running prediction…':!online?'API offline':`Predict GO Terms${seqCount>0?` (${seqCount})`:''}`}
          </button>
          <p className="text-xs text-center text-gray-400 -mt-1">Ctrl+Enter to submit</p>

          {/* Tiers */}
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-800">Evidence Tiers</h3>
              <p className="text-xs text-gray-500 mt-0.5">Score = IA weight × confidence · Tier reflects GO term specificity</p>
            </div>
            <div className="divide-y divide-gray-100">
              {[
                {tier:'STRONG' as Tier,    rule:'IA > 5.0  ·  conf ≥ 0.30', desc:'Highly specific GO term — even moderate confidence is meaningful'},
                {tier:'MODERATE' as Tier,  rule:'IA > 2.0  ·  conf ≥ 0.50', desc:'Moderately specific term with acceptable model confidence'},
                {tier:'INDICATIVE' as Tier,rule:'IA > 1.0  ·  conf ≥ 0.65', desc:'Lower specificity — high confidence required to qualify'},
              ].map(({tier,rule,desc})=><div key={tier} className="px-4 py-3 flex items-start gap-3">
                <TierBadge tier={tier}/>
                <div><p className="text-xs font-mono text-gray-600">{rule}</p><p className="text-xs text-gray-400 mt-0.5">{desc}</p></div>
              </div>)}
            </div>
          </div>

          {/* How to use */}
          <Collapsible title="How to Use FunGO" icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#1B5FA8" strokeWidth="1.3"/><path d="M8 7v4M8 5.5v.5" stroke="#1B5FA8" strokeWidth="1.3" strokeLinecap="round"/></svg>}>
            <div className="px-5 py-4 space-y-4 text-xs text-gray-600 leading-relaxed">
              <div><p className="font-semibold text-gray-800 mb-1">Step 1 — Prepare your sequence</p>
              <p>Paste a protein sequence in FASTA format. Each entry must start with a header line beginning with <code className="bg-gray-100 px-1 rounded">{'>'}</code>. Up to 10 sequences can be submitted at once.</p></div>
              <div><p className="font-semibold text-gray-800 mb-1">Step 2 — Add taxonomy ID (recommended)</p>
              <p>Include <code className="bg-gray-100 px-1 rounded">OX=9606</code> in the header for better accuracy. Use the lookup below if you need to find the taxon ID:</p>
              <div className="mt-2 relative">
                <input type="text" placeholder="e.g. homo sapiens, mus musculus…" value={taxQ} onChange={e=>taxSearch(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none"/>
                {taxLoad&&<div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-gray-200 border-t-blue-500 rounded-full animate-spin"/>}
              </div>
              {taxRes.length>0&&<div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                {taxRes.map((r,i)=><div key={i} className="p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                  {r.error?<span className="text-red-500">{r.error}</span>:<div className="flex items-center justify-between gap-2"><span className="font-medium text-gray-800">{r.scientific_name}</span><span className="font-mono text-blue-700 font-bold">OX={r.taxon_id}</span></div>}
                </div>)}
              </div>}</div>
              <div><p className="font-semibold text-gray-800 mb-1">Step 3 — Run and interpret</p>
              <p>Click <strong>Predict GO Terms</strong>. Results are sorted by Score (IA weight × confidence). Click any GO term to open it in AmiGO. Download the full CSV for all predictions beyond the top 20.</p></div>
<<<<<<< HEAD
              <div className="space-y-2">
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="font-semibold text-blue-800 mb-1">What is IA Weight?</p>
                  <p className="text-blue-700">Information Accretion (IA) weight measures how <strong>specific</strong> a GO term is in the ontology hierarchy. A high IA value (e.g. 7.0) means the term is very specific — few proteins carry that annotation. A low IA (e.g. 0.5) means the term is generic. Tier assignment is primarily based on IA weight.</p>
                </div>
                <div className="bg-teal-50 border border-teal-100 rounded-lg p-3">
                  <p className="font-semibold text-teal-800 mb-1">What is Confidence Score?</p>
                  <p className="text-teal-700">Confidence reflects the XGBoost classifier's certainty for predicting that GO term (0–100%). Higher confidence means the model is more certain. Combined Score = IA × Confidence — this balances specificity and certainty.</p>
                </div>
                <div className="rounded-lg p-3 space-y-1.5" style={{background:'#fefce8',border:'1px solid #fef08a'}}>
                  <p className="font-semibold mb-1" style={{color:'#713f12'}}>Evidence Tier Descriptions</p>
                  <p style={{color:'#92400e'}}><strong>Strong Evidence</strong> (IA &gt; 5.0, conf ≥ 30%): Very specific GO term. Even moderate confidence is biologically meaningful for such specific annotations.</p>
                  <p style={{color:'#1e40af'}}><strong>Moderate Evidence</strong> (IA &gt; 2.0, conf ≥ 50%): Moderately specific term with acceptable model confidence.</p>
                  <p style={{color:'#374151'}}><strong>Indicative</strong> (IA &gt; 1.0, conf ≥ 65%): Lower specificity term — requires higher confidence to qualify as a prediction worth reporting.</p>
                </div>
=======
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <p className="font-semibold text-blue-800 mb-1">Understanding the tiers</p>
                <p className="text-blue-700">Tier is assigned based on GO term specificity (Information Accretion weight), not confidence alone. A Strong Evidence hit indicates the predicted GO term is highly specific in the ontology hierarchy. Confidence and IA weight are shown separately so you can evaluate both dimensions independently.</p>
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
              </div>
            </div>
          </Collapsible>
        </div>

        {/* Right */}
        <div className="space-y-4">
          {result&&<p className="text-sm text-gray-500">
            <span className="text-gray-900 font-semibold">{result.metadata.total_displayed}</span> predictions ·{' '}
            <span className="text-gray-900 font-semibold">{result.metadata.n_proteins}</span> protein{result.metadata.n_proteins!==1?'s':''} ·{' '}
            <span className="text-blue-700 font-semibold">{result.metadata.elapsed_seconds}s</span> · {result.metadata.device}
          </p>}

          {loading&&<div className="border border-gray-200 rounded-xl py-16 flex flex-col items-center gap-5 bg-white">
            <div className="relative w-12 h-12"><div className="absolute inset-0 rounded-full border-2 border-blue-100 border-t-blue-600 animate-spin"/></div>
            <div className="text-center"><p className="text-sm font-semibold text-gray-800">Running prediction pipeline</p><p className="text-xs text-gray-500 mt-1">ESM2-t36-3B embedding · XGBoost scoring</p><p className="text-xs text-gray-400 mt-0.5">First run may take 1–2 minutes</p></div>
          </div>}

          {error&&<div className="border border-red-200 rounded-xl px-5 py-4 bg-red-50"><p className="text-sm font-semibold text-red-600">Prediction failed</p><p className="text-xs font-mono text-red-500 mt-1 break-all">{error}</p></div>}

          {result&&Object.entries(result.predictions).map(([pid,data])=><ProteinCard key={pid} pid={pid} data={data} jobId={result.job_id}/>)}

          {!loading&&!error&&!result&&<div className="border border-gray-200 rounded-xl py-16 text-center bg-white">
            <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" stroke="#1B5FA8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-base font-semibold text-gray-800">Paste a FASTA sequence to begin</p>
            <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">Predictions are returned across all three GO ontologies, ranked by combined specificity and confidence score.</p>
            <div className="flex justify-center gap-2 mt-5 flex-wrap">
              {Object.entries(ONT).map(([key,o])=><span key={key} className={clsx('text-xs px-3 py-1 rounded-full',o.pill)}><span className="w-1.5 h-1.5 rounded-full inline-block mr-1.5" style={{background:o.dot}}/>{o.label}</span>)}
            </div>
          </div>}
        </div>
      </div>
    </main>

    {/* FOOTER */}
<<<<<<< HEAD
    <footer className="mt-12" style={{background:'linear-gradient(135deg,#0f172a,#1e293b)',borderTop:'none'}}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider mb-6" style={{color:"#94a3b8"}}>Development Team</p>
=======
    <footer className="border-t border-gray-200 bg-gray-50 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-6">Development Team</p>
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {TEAM.map(dev=><div key={dev.name} className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{background:dev.color}}>{dev.initials}</div>
            <div>
<<<<<<< HEAD
              <p className="text-sm font-semibold" style={{color:"#f1f5f9"}}>{dev.name}</p>
              <p className="text-xs" style={{color:"#94a3b8"}}>{dev.title}</p>
              <p className="text-xs" style={{color:"#64748b"}}>{dev.dept}</p>
              <p className="text-xs" style={{color:"#64748b"}}>{dev.uni}</p>
              <a href={`mailto:${dev.email}`} className="text-xs hover:underline mt-0.5 block" style={{color:"#60a5fa"}}>{dev.email}</a>
            </div>
          </div>)}
        </div>
        <div className="mt-8 pt-5 flex items-center justify-between flex-wrap gap-3 text-xs" style={{borderTop:"1px solid #1e3a5f",color:"#475569"}}>
=======
              <p className="text-sm font-semibold text-gray-800">{dev.name}</p>
              <p className="text-xs text-gray-500">{dev.title}</p>
              <p className="text-xs text-gray-400">{dev.dept}</p>
              <p className="text-xs text-gray-400">{dev.uni}</p>
              <a href={`mailto:${dev.email}`} className="text-xs text-blue-600 hover:underline mt-0.5 block">{dev.email}</a>
            </div>
          </div>)}
        </div>
        <div className="border-t border-gray-200 mt-8 pt-5 flex items-center justify-between flex-wrap gap-3 text-xs text-gray-400">
>>>>>>> aec45cb (UI: publication-quality redesign Phase 1)
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="FunGO" width={80} height={34} className="object-contain opacity-60"/>
            <span>School of Biochemistry and Biotechnology · University of the Punjab, Lahore</span>
          </div>
          <span>ESM2-t36-3B · XGBoost · {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  </div>
}
