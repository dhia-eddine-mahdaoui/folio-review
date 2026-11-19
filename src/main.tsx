import {useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Archive,FileText,FolderOpen,Upload,Search,Trash2,LockKeyhole,Files,ChevronRight} from 'lucide-react'
import {Reader} from './Reader'
import {list,get,change,indexPdf,type RecordFile} from './register'
import {readDraft,writeDraft} from './draft'
import './style.css'
import './library.css'

function App(){
  const [items,setItems]=useState<Awaited<ReturnType<typeof list>>>([]),[active,open]=useState<RecordFile>(),[filter,search]=useState('')
  const [message,status]=useState(''),[error,fail]=useState(''),[drag,dragging]=useState(false)
  const picker=useRef<HTMLInputElement>(null),locked=useRef(false)
  async function refresh(){setItems((await list()).sort((a,b)=>b.added.localeCompare(a.added)))}
  useEffect(()=>{(async()=>{
    const old=await readDraft()
    if(old && !localStorage.getItem('folio-migrated-draft')){
      const imported=await indexPdf(old.file,status)
      await change(imported.id,prior=>{
        if(!prior)throw Error()
        const figures=old.review.metrics.flatMap(m=>{
          const d=old.decisions[m.id],s=d?.source
          if(!s || d.status!=='Approved'||prior.figures.some(f=>f.id==='legacy-'+m.id))return []
          return [{id:'legacy-'+m.id,label:m.name,amount:s.value,unit:m.unit,period:m.period,note:d.note,source:{text:s.quote,page:s.page,box:s.box},saved:d.timestamp}]
        })
        return {...prior,figures:[...prior.figures,...figures]}
      })
      localStorage.setItem('folio-migrated-draft',imported.id)
      // Preserve the original draft with exclusions and historical notes for recovery.
    }
    await refresh()
  })().catch(()=>fail('Could not open browser storage. Allow site data and reload.')).finally(()=>status(''))},[])
  async function ingest(files:File[]){
    if(locked.current||!files.length)return
    locked.current=true;fail('');const problems:string[]=[]
    for(const file of files){
      try{const workpaper=file.name.toLowerCase().endsWith('.folio'); if(!workpaper&&!file.name.toLowerCase().endsWith('.pdf'))throw Error('Choose a PDF file.')
        status('Opening '+file.name);const doc=workpaper?await (await import('./backup')).restore(file,status):await indexPdf(file,status);if(files.length===1)open(doc)
      }catch(e){problems.push(file.name+' — '+(e instanceof Error?e.message:'Import failed.'))}
    }
    try{await refresh()}catch{problems.push('Could not refresh the document list.')}
    locked.current=false;status('');fail(problems.join(' · '))
  }
  async function remove(id:string,name:string){
    if(!confirm('Delete '+name+' and its saved figures from this browser?'))return
    try{const old=await readDraft();if(old&&old.file.name===name)await writeDraft();await change(id,()=>undefined);await refresh()}catch{fail('Could not delete this document.')}
  }
  return <div className="app"><header className="mast"><div className="word"><Archive/>Folio</div><span>Financial workpapers</span><small><LockKeyhole size={14}/>Private workspace</small></header>
  {error&&<div role="alert" className="alert">{error}<button onClick={()=>fail('')}>Dismiss</button></div>}
  {message&&<div role="status" className="working">{message}</div>}
  {active?<Reader key={active.id} initial={active} back={()=>{open(undefined);void refresh().catch(()=>fail('Library refresh failed.'))}}/>:
  <div className="shell"><nav className="rail"><span>WORKSPACE</span><strong><FolderOpen/>Document library</strong><div className="storage"><LockKeyhole/><b>Device storage</b><small>PDFs and reviewed figures are saved in this browser.</small></div></nav>
  <main className="library"><div className="library-head"><div><span className="kicker">WORKPAPERS</span><h1>Document library</h1></div><button className="solid" disabled={!!message} onClick={()=>picker.current?.click()}><Upload/>Import PDFs</button></div>
  <input ref={picker} type="file" hidden multiple accept=".pdf,.folio,application/pdf" aria-label="Choose PDF files" onChange={e=>{void ingest(Array.from(e.target.files??[]));e.target.value=''}}/>
  <section className={'drop '+(drag?'drag':'')} onDragOver={e=>{e.preventDefault();dragging(true)}} onDragLeave={()=>dragging(false)} onDrop={e=>{e.preventDefault();dragging(false);void ingest(Array.from(e.dataTransfer.files))}}>
    <div className="sheets" aria-hidden="true"><i/><i/><i><FileText/></i></div><div><h2>Import financial documents</h2><p>Drop annual reports, statements or diligence PDFs here.</p><small>PDFs up to 50 MB · Import a .folio workpaper to restore reviewed figures</small></div></section>
  <div className="sectionbar"><h2>Documents <sup>{items.length}</sup></h2><label className="search"><Search/><input aria-label="Filter documents" placeholder="Find a document" value={filter} onChange={e=>search(e.target.value)}/></label></div>
  <div className="filetable"><div className="headrow"><span>Document name</span><span>Pages</span><span>Figures</span><span/></div>
  {items.filter(i=>i.name.toLowerCase().includes(filter.toLowerCase())).map(i=><div className="filerow" key={i.id}><button onClick={async()=>{try{const d=await get(i.id);if(!d)throw Error();open(d)}catch{fail('Document unavailable. Refresh the library.')}}}><FileText/>{i.name}<ChevronRight/></button><span>{i.pages}</span><span>{i.count}</span><button aria-label={'Delete '+i.name} onClick={()=>void remove(i.id,i.name)}><Trash2/></button></div>)}
  {!items.some(i=>i.name.toLowerCase().includes(filter.toLowerCase()))&&<div className="empty"><Files/><strong>{items.length?'No matching documents':'Your library is empty'}</strong><p>{items.length?'Try another filename.':'Imported files will appear here with their saved figures.'}</p></div>}</div></main></div>}</div>
}
createRoot(document.getElementById('root')!).render(<App/>)
