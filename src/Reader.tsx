import {useEffect,useMemo,useState} from 'react'
import {Search,Download,Plus,Bookmark,ChevronLeft,Trash2} from 'lucide-react'
import {analyzeLines,receiptCheck,type Finding} from './findings'
import {Document} from './Document'
import {change,download,scanPage,type Figure,type Line,type RecordFile} from './register'

export function Reader({initial,back}:{initial:RecordFile;back:()=>void}){
  const [doc,setDoc]=useState(initial),[url,setUrl]=useState(''),[page,setPage]=useState(1),[query,search]=useState(''),[tab,setTab]=useState('Findings'),[limit,setLimit]=useState(30)
  const [line,choose]=useState<Line>(),[edit,setEdit]=useState<Figure>(),[error,fail]=useState(''),[saving,busy]=useState(false)
  useEffect(()=>{const u=URL.createObjectURL(initial.file);setUrl(u);return()=>URL.revokeObjectURL(u)},[initial.file])
  const [exporting,setExporting]=useState(false)
  const [proposal,propose]=useState<Finding>(),[scanning,scan]=useState(false),[showAll,displayAll]=useState(false)
  const analysis=useMemo(()=>analyzeLines(doc.lines),[doc.lines])
  const suggested=analysis.items
  const check=receiptCheck(suggested)
  const reviewed=(f:Finding)=>doc.figures.some(r=>r.source.page===f.source.page&&r.source.text===f.source.text&&r.source.column===f.source.column)
  const pending=suggested.filter(f=>!reviewed(f))
  const hits=doc.lines.filter(l=>query.trim()?l.text.toLowerCase().includes(query.trim().toLowerCase()):false)
  function capture(l:Line,f?:Figure,candidate?:Finding){propose(candidate);choose(l);setEdit(f);setPage(l.page);setTab('Capture');fail('')}
  async function save(f:Figure,remove=false){
    busy(true);fail('')
    try{
      const updated=await change(doc.id,prior=>{
        if(!prior)throw Error()
        const current=prior.figures.find(x=>x.id===f.id)
        if(edit && current?.saved!==edit.saved)throw Error()
        const figures=prior.figures.filter(x=>x.id!==f.id)
        if(!remove)figures.push(f)
        return {...prior,figures}
      })
      setDoc(updated!);setEdit(undefined);setTab('Register')
    }catch{fail('Could not save. Reopen this document to load the latest version and check browser storage.')}
    finally{busy(false)}
  }
  return <><div className="reader-head"><button onClick={back}><ChevronLeft/>Library</button><strong>{doc.name}</strong><button onClick={async()=>{try{await (await import('./backup')).backup(doc)}catch{fail('Could not download the workpaper.')}}}><Download/>Backup</button><button disabled={exporting} onClick={async()=>{setExporting(true);try{await (await import('./workbook')).writeWorkbook(doc)}catch{fail('Workbook export failed. Try again.')}finally{setExporting(false)}}}><Download/>{exporting?'Writing workbook…':'Excel workbook'}</button><button disabled={!doc.figures.length} onClick={()=>download(doc)}><Download/>Export CSV</button></div>
  <div className="desk"><div>{url&&<Document url={url} filename={doc.name} pages={doc.pages} page={page} onPage={setPage} onRegion={box=>capture({page,box,text:''})} source={line&&{page:line.page,quote:line.text,box:line.box,value:'',basis:''}}/>}</div>
  <aside><nav className="tabs">{['Findings','Search','Register',...(tab==='Capture'?['Capture']:[])].map(t=><button key={t} aria-pressed={t===tab} onClick={()=>setTab(t)}>{t}{t==='Register'?' ('+doc.figures.length+')':''}</button>)}</nav>
  {error&&<p role="alert">{error}</p>}
  {tab==='Findings'&&<section className="finding-pane"><div className="finding-title"><div><small>EXTRACTION</small><h2>Document findings</h2></div><b>{pending.length}</b></div>
  {analysis.review_flags.length>0&&<p>Review needed · {analysis.review_flags.map(f=>f.replaceAll('_',' ')).join(', ')}</p>}
  {analysis.checks.length>0&&<details><summary>{analysis.checks.filter(c=>c.status==='passed').length} of {analysis.checks.length} arithmetic checks passed</summary>{analysis.checks.map(c=><p key={c.name+c.period+c.page}>{c.name} · {c.period} · {c.status} (difference {c.difference} {c.unit})</p>)}</details>}
  {check&&<div className="reconcile"><strong>{check.matches?'Receipt total reconciles':'Check receipt total'}</strong><span>{check.calculation} {check.unit}{check.matches?'':' · Difference '+check.difference}</span></div>}
  <div className="queue-filter"><button aria-pressed={!showAll} onClick={()=>displayAll(false)}>To review ({pending.length})</button><button aria-pressed={showAll} onClick={()=>displayAll(true)}>All ({suggested.length})</button></div>
  <div className="findings">{(showAll?suggested:pending).map((f,i)=><button key={i} onClick={()=>capture(f.source,undefined,f)}><span>{f.label}<small>{f.period&&f.period+' · '}Page {f.source.page} · {reviewed(f)?'Reviewed':doc.ocrPages?.includes(f.source.page)?'Scan · needs review':'Needs review'}</small></span><strong>{f.amount} <em>{f.unit}</em></strong></button>)}</div>
  {!(showAll?suggested:pending).length&&<p>{suggested.length?'Review queue complete.':'No supported fields identified. Search the text, read a scanned page, or select an area of the PDF.'}</p>}
  <div className="scan-actions"><button disabled={scanning} onClick={async()=>{scan(true);fail('');try{setDoc(await scanPage(doc,page))}catch(e){fail(e instanceof Error?e.message:'Could not recognize this page.')}finally{scan(false)}}}>{scanning?'Reading scan…':'Run OCR on page '+page}</button><button onClick={()=>capture({page,text:'',box:[0,0,0,0]})}>Add figure</button></div></section>}
  {tab==='Search' &&<><label className="search"><Search/><input placeholder="Find a word or figure" aria-label="Search document" value={query} onChange={e=>{search(e.target.value);setLimit(30)}}/></label>
  <div className="sectionbar"><span>{query.trim()?hits.length+' matching lines':'Search all pages'}</span><button onClick={()=>capture({page,text:'',box:[0,0,0,0]})}><Plus/>Capture page {page}</button></div>
  <div className="results">{hits.slice(0,limit).map((l,i)=><button key={i} onClick={()=>capture(l)}><small>PAGE {l.page}</small><span>{l.text}</span></button>)}{!hits.length&&<p>{!query.trim()?'Enter a word, phrase or amount.':doc.lines.length?'Try another search or capture a figure from the visible page.':'This PDF has no searchable text. Read the page and use Capture page to transcribe a figure.'}</p>}{hits.length>limit&&<button onClick={()=>setLimit(limit+50)}>Show more matches</button>}</div></>}
  {tab==='Register'&&<><div className="sectionbar"><span>Reviewed figures</span><button onClick={()=>capture({page,text:'',box:[0,0,0,0]})}><Plus/>Add figure</button></div>{!doc.figures.length&&<p>Choose a source line in Search to record your first figure.</p>}{doc.figures.map(f=><button className="saved-row" key={f.id} onClick={()=>capture(f.source,f)}><strong>{f.label}</strong><b>{f.amount} {f.unit}</b><small>{f.period} · Page {f.source.page}</small></button>)}</>}
  {tab==='Capture'&&line&&<form key={edit?.id??line.page+line.text} className="entry" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);const v=(k:string)=>String(data.get(k)??'').trim()
    if(!v('label')||!v('quote')){fail('Complete the metric and evidence.');return}
    void save({id:edit?.id??crypto.randomUUID(),label:v('label'),amount:v('amount'),unit:v('unit'),period:v('period'),note:v('note'),source:{...line,text:v('quote')},saved:new Date().toISOString()})
  }}><h2>{edit?'Edit figure':'Capture figure'}</h2><label>Source · page {line.page}<textarea name="quote" required readOnly={!!line.text && !edit && line.box[2]>0} defaultValue={line.text} placeholder="Transcribe the source text"/></label>
  <label>Metric<input name="label" required defaultValue={edit?.label??proposal?.label??line.text.split(/(?:[0-9]|[$£€])/)[0].replace(/[^a-zA-Z)]+$/,'').trim()} placeholder="e.g. Operating income"/></label>
  <div className="chips">{Array.from(new Set(line.text.match(/(?:\(\d[\d,]*(?:\.\d+)?\)|-?\d[\d,]*(?:\.\d+)?)/g)??[])).slice(0,24).map(n=><button type="button" key={n} onClick={e=>{const input=e.currentTarget.form?.elements.namedItem('amount') as HTMLInputElement;input.value=n.replaceAll(',','').replace(/^\((.*)\)$/,'-$1');input.focus()}}>{n}</button>)}</div>
  <div className="pair"><label>Value<input name="amount" required pattern="-?[0-9]+([.][0-9]+)?" defaultValue={edit?.amount??proposal?.amount} list="numbers" placeholder="Numeric value"/></label><label>Unit<input name="unit" defaultValue={edit?.unit??proposal?.unit} placeholder="e.g. USD millions"/></label></div>
  <datalist id="numbers">{Array.from(new Set(line.text.match(/-?\d[\d,]*(?:\.\d+)?/g)??[])).map(n=><option key={n} value={n.replaceAll(',','')}/>)}</datalist>
  <label>Reporting period<input name="period" defaultValue={edit?.period??proposal?.period} placeholder="If known"/></label><label>Reviewer note<textarea name="note" defaultValue={edit?.note} placeholder="Optional"/></label>
  <button className="solid" disabled={saving}><Bookmark/>Save figure</button>{edit&&<button type="button" disabled={saving} onClick={()=>{if(confirm('Delete this recorded figure?'))void save(edit,true)}}><Trash2/>Delete figure</button>}</form>}</aside></div></>
}
