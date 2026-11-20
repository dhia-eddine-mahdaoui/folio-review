import type {AgentDraft} from './agentDraft'
import {appendHistory, sourceHash} from './audit'
import {getSqlite,putSqlite,registerSqlite,sqlite,type RegisterEntry} from './storage'
import {normalizedAmount,sourceScale} from './amount'
import {findings} from './findings'
import {findingKey, queueCounts, workpaperFindings, type Status, type Assignment, type AuditEvent, type Exclusion} from './review'
import type {Finding} from './findings'
type Word = {text:string; start:number; end:number; grid?:{id:number;column:number;span:number}; box:[number,number,number,number]}
export type Line = {words?:Word[]; layoutText?:string; block_type?:string; wordConfidence?:{text:string;confidence:number}[]; rawText?:string; row_label?:string; column_heading?:string; cell_box?:Line["box"] | null; extraction_run_id?:string; column?:number;page:number; text:string; box:[number,number,number,number]; confidence?:number; ocr?:boolean}
export type Figure = {id:string; label:string; verbatimLabel?:string; amount:string; unit:string; period:string; note:string; source:Line; saved:string; findingKey?:string; original?:Finding; reviewer?:string; changeReason?:string}
export type RecordFile = {id:string; name:string; pages:number; added:string; file:File; lines:Line[]; figures:Figure[]; revision?:string; drafts?:Record<string,AgentDraft>; extractionRuns?:Record<number,string>; ocrPages?:number[]; ocrUpdated?:Record<number,string>; sample?:boolean; exclusions?:Record<string, Exclusion>; assignments?:Record<string,Assignment>; history?:AuditEvent[]}
export type Header = Pick<RecordFile,'id'|'name'|'pages'|'added'|'sample'> & {
  count: number
  review?: {total: number; pending: number; unresolved?: number; scans?: number; counts?:Record<Status,number>}
}

export function summarize(record: RecordFile): Header {
  const {id, name, pages, added, figures, lines, exclusions, sample} = record
  const proposed = workpaperFindings(findings(lines), figures, exclusions, record.assignments)
  const counts = queueCounts(proposed, figures, exclusions)
  const pending = counts.Pending
  const unresolved = counts['On Hold']+counts.Escalated
  const scans = (record.ocrPages ?? []).length
  return {id, name, pages, added, sample, count: figures.length, review: {total: proposed.length, pending, unresolved, scans, counts}}
}
let connection:Promise<IDBDatabase>
function database(){
  return connection ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open('folio-document-register',1)
    request.onupgradeneeded=()=>{for(const name of ['files','headers']) request.result.createObjectStore(name,{keyPath:'id'})}
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}
async function read<T>(store:string,id?:string):Promise<T>{
  const db=await database()
  return new Promise((resolve,reject)=>{
    const table=db.transaction(store).objectStore(store)
    const request=id ? table.get(id) : table.getAll()
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}
let backend: boolean | undefined
const backendKey = 'folio-opfs-migrated'
let localLock:Promise<unknown> = Promise.resolve()
async function locked<T>(action:()=>Promise<T>):Promise<T> {
  if (navigator.locks) return navigator.locks.request('folio-workpaper-storage',action)
  const result = localLock.then(action)
  localLock = result.catch(()=>{})
  return result
}

async function useSqlite() {
  if (backend!==undefined) return backend
  if (!navigator.locks || !navigator.storage?.getDirectory) return backend=false
  let migrated:boolean
  try {
    migrated = !!await sqlite('migrated')
  } catch (cause) {
    if (localStorage.getItem(backendKey)) throw cause
    console.warn('Folio is using IndexedDB because OPFS is unavailable.',cause)
    return backend=false
  }
  if (!migrated) {
    const headers = await read<Header[]>('headers')
    for (const {id} of headers) {
      const record = await read<RecordFile>('files',id)
      if (record) await putSqlite(await prepare(record),summarize(record))
    }
    await sqlite('finish-migration')
  }
  localStorage.setItem(backendKey,'1')
  return backend=true
}

async function prepare(record:RecordFile, prior?:RecordFile) {
  const history = await appendHistory(record.history ?? [],sourceHash(record.id),prior?.history)
  return {...withCurrentCitations(record),history,revision:crypto.randomUUID()}
}

function withCurrentCitations(record:RecordFile) {
  if (!record.figures.some(figure=>figure.original && !figure.verbatimLabel)) return record
  const extracted = new Map(findings(record.lines).map(finding=>[findingKey(finding),finding]))
  const figures = record.figures.map(figure=>{
    if (!figure.original || figure.verbatimLabel) return figure
    const original = extracted.get(figure.findingKey ?? findingKey(figure.original))
    const source = original && figure.source.text===figure.original.source.text &&
      (!figure.source.extraction_run_id || figure.source.extraction_run_id===original.source.extraction_run_id) &&
      !record.ocrUpdated?.[figure.source.page] ? original.source : figure.source
    return {...figure,source,verbatimLabel:(original ?? figure.original).source_label ?? figure.original.label}
  })
  return {...record,figures}
}

export const list = () => locked(async()=>{
  if (await useSqlite()) return (await sqlite<string[]>('headers')).map(value=>JSON.parse(value) as Header)
  const headers = await read<Header[]>('headers')
  const records: Header[] = []
  for (const header of headers) {
    const current = header.review?.counts ? header : await read<RecordFile>('files',header.id)
    if (current) records.push('file' in current ? summarize(current) : current)
  }
  return records
})

export const get = (id:string) => locked(async()=>{
  const record = await useSqlite() ? await getSqlite(id) : await read<RecordFile|undefined>('files',id)
  return record && withCurrentCitations(record)
})

export const readRegister = (query='',source='') => locked(async()=>{
  const needle = query.trim().toLowerCase()
  if (await useSqlite()) return registerSqlite(needle,source)
  const headers = await read<Header[]>('headers')
  const entries: RegisterEntry[] = []
  for (const header of headers.filter(item=>item.count && !item.sample && (!source || item.id===source))) {
    const record = await read<RecordFile>('files',header.id)
    if (record) for (const figure of withCurrentCitations(record).figures) {
      if ([record.name,figure.label,figure.verbatimLabel ?? '',figure.amount,figure.unit,figure.period]
        .some(value=>value.toLowerCase().includes(needle))) entries.push({id:record.id,document:record.name,figure})
    }
  }
  return entries.sort((a,b)=>b.figure.saved.localeCompare(a.figure.saved))
})

export const readActivity = () => locked(async()=>{
  if (await useSqlite()) {
    const rows = await sqlite<{id:string;document:string;history:string | null}[]>('history')
    return rows.map(({id,document,history})=>({id,document,history:JSON.parse(history ?? '[]') as AuditEvent[]}))
  }
  const headers = await read<Header[]>('headers')
  const result:{id:string;document:string;history:AuditEvent[]}[] = []
  for (const {id,name,sample} of headers) {
    if (sample) continue
    const record = await read<RecordFile>('files',id)
    if (record) result.push({id,document:name,history:record.history ?? []})
  }
  return result
})

export function change(id:string,update:(previous?:RecordFile)=>RecordFile|undefined) {
  return locked(async()=>{
    const opfs = await useSqlite()
    const prior = opfs ? await getSqlite(id) : await read<RecordFile|undefined>('files',id)
    const value = update(prior)
    const next = value && await prepare(value,prior)
    if (opfs) {
      if (next) await putSqlite(next,summarize(next),!!prior)
      else await sqlite('delete',{key:id})
    } else {
      const db = await database()
      await new Promise<void>((resolve,reject)=>{
        const tx = db.transaction(['files','headers'],'readwrite')
        const files = tx.objectStore('files'), headers = tx.objectStore('headers')
        const request = files.get(id)
        request.onsuccess=()=>{
          if (!!request.result!==!!prior || request.result?.revision!==prior?.revision) return tx.abort()
          if (next) {
            files.put(next)
            headers.put(summarize(next))
          } else {files.delete(id);headers.delete(id)}
        }
        tx.oncomplete=()=>resolve()
        tx.onabort=()=>reject(tx.error ?? Error('The workpaper changed in another tab.'))
      })
    }
    return next
  })
}
export async function indexPdf(file:File,onProgress:(message:string)=>void, options:{
  sample?:boolean;docling?:boolean;restore?:{lines?:Line[];ocrPages?:number[]; runs?:Record<number,string>}
} = {}):Promise<RecordFile>{
  const {sample=false,docling=false,restore} = options
  if(file.size>50*1024*1024)throw Error('Choose a PDF smaller than 50 MB.')
  const bytes=await file.arrayBuffer()
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  const id=(sample ? 'sample-' : '')+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')
  const existing=await get(id)
  if(existing)return existing
  const {getDocument, Util} = await import('./pdf')
  const task=getDocument({data:bytes,standardFontDataUrl:'/pdf-fonts/'})
  let worker:Awaited<ReturnType<typeof import("./ocr").startOCR>>|undefined
  const ocrPages:number[]=[]
  try{
    const doc=await task.promise
    if(doc.numPages>1000)throw Error('The document exceeds the 1,000-page indexing limit.')
    if (restore?.lines) {
      return {id,file,name:file.name,pages:doc.numPages,added:new Date().toISOString(),sample,figures:[],
        lines:restore.lines,ocrPages:restore.ocrPages,extractionRuns:restore.runs}
    }
    const lines:Line[]=[]
    for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
      onProgress('Indexing page '+pageNumber+' of '+doc.numPages)
      const page=await doc.getPage(pageNumber), viewport=page.getViewport({scale:1})
      const rows=new Map<number,{left:number; text:string; rect:number[]}[]>()
      for(const item of (await page.getTextContent()).items){
        if(!('str' in item)||!item.str.trim())continue
        const [,,,,x,y]=item.transform
        const rect=Util.normalizeRect([...viewport.convertToViewportPoint(x,y-item.height*.18),...viewport.convertToViewportPoint(x+item.width,y+item.height*.86)])
        const key=Math.round(rect[3]/2)
        const items=rows.get(key)??[]
        items.push({left:rect[0],text:item.str.trim(),rect}); rows.set(key,items)
      }
      if(rows.size<3){
        onProgress('Reading scan '+pageNumber+' of '+doc.numPages)
        const {startOCR,recognizePage}=await import('./ocr')
        worker??=await startOCR()
        const scanned=await recognizePage(page,worker)
        if(scanned.length){lines.push(...scanned);ocrPages.push(pageNumber);page.cleanup();continue}
      }
      for(const [,items] of [...rows].sort(([a],[b])=>a-b)){
        items.sort((a,b)=>a.left-b.left)
        const box:[number,number,number,number]=[1,1,0,0]
        for(const {rect} of items){
          box[0]=Math.min(box[0],rect[0]/viewport.width);box[1]=Math.min(box[1],rect[1]/viewport.height)
          box[2]=Math.max(box[2],rect[2]/viewport.width);box[3]=Math.max(box[3],rect[3]/viewport.height)
        }
        let offset=0
        const words=items.map(({text,rect})=>{const start=offset;offset+=text.length+1;return {text,start,end:offset-1,box:[rect[0]/viewport.width,rect[1]/viewport.height,rect[2]/viewport.width,rect[3]/viewport.height] as Line['box']}})
        lines.push({page:pageNumber,text:items.map(i=>i.text).join(' '),box,words})
      }
      page.cleanup()
    }
    let indexed = lines
    if (docling) {
      onProgress('Recognizing local table structure')
      const response = await fetch('/api/local/layout',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file,signal:AbortSignal.timeout(190000)})
      const result = await response.json().catch(()=>null)
      if (!response.ok || !Array.isArray(result?.tables)) throw Error(result?.error ?? 'The local Docling engine is unavailable.')
      const {applyLayout} = await import('./layout')
      indexed = applyLayout(lines,result.tables)
    }
    const extractionRuns = Object.fromEntries(Array.from({length:doc.numPages},(_,i)=>[i+1,crypto.randomUUID()]))
    const record={id,file,extractionRuns,name:file.name,pages:doc.numPages,added:new Date().toISOString(),lines:indexed.map(line=>({...line,extraction_run_id:extractionRuns[line.page]})),ocrPages,sample,figures:[]}
    return restore ? record : (await change(id,old=>old??record))!
  }finally{try{await worker?.terminate()}finally{await task.destroy()}}
}
export function download(record: RecordFile) {
  downloadRegister(record.figures.map(figure => ({figure, document: record.name})), record.name.replace(/\.pdf$/i, '') + '-register.csv')
}

export function downloadRegister(entries: {figure: Figure; document: string}[], filename = 'folio-register.csv') {
  const rows=[['Metric','Value','Unit','Period','Document','Page','Evidence','Notes','Reviewed UTC','Original value','Original unit','Original period','Reviewer ID','Change reason','Verbatim label','Normalized value','Normalized unit']]
  for(const {figure, document} of entries){
    const f = sourceScale(figure)
    const normalized = normalizedAmount(f.amount,f.unit)
    rows.push([f.label,f.amount,f.unit,f.period,document,String(f.source.page),f.source.text,f.note,f.saved,f.original?.amount??'',f.original?.unit??'',f.original?.period??'',f.reviewer??'',f.changeReason??'',f.verbatimLabel??f.original?.source_label??f.original?.label??'',normalized?.value??'',normalized?.unit??''])
  }
  const csv=rows.map(row=>row.map((v,i)=>{
    if([1,9,15].includes(i) && /^-?\d+(\.\d+)?$/.test(v))return v
    return '"'+(/^[\s]*[=+@-]/.test(v)?"'":"")+v.replaceAll('"','""')+'"'
  }).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=filename;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export async function readRegion(record:RecordFile,pageNumber:number,region?:Line['box'],endpoint?:string){
  const [{recognizePage}, {getDocument}] = await Promise.all([import('./ocr'), import('./pdf')])
  const task=getDocument({data:await record.file.arrayBuffer(),standardFontDataUrl:'/pdf-fonts/'})
  try{
    return await recognizePage(await (await task.promise).getPage(pageNumber),undefined,region,endpoint)
  }finally{await task.destroy()}
}

export async function scanPage(record:RecordFile,pageNumber:number,reviewer:string,endpoint?:string){
  const scanned=await readRegion(record,pageNumber,undefined,endpoint)
  if(!scanned.length)throw Error('No readable text found on this page.')
  return (await change(record.id,prior=>{
    if(!prior || prior.ocrUpdated?.[pageNumber]!==record.ocrUpdated?.[pageNumber])throw Error()
    const run = crypto.randomUUID()
    const lines=[...prior.lines.filter(l=>l.page!==pageNumber),...scanned.map(line=>({...line,extraction_run_id:run}))].sort((a,b)=>a.page-b.page)
    const saved=new Date().toISOString()
    const before = findings(prior.lines).filter(finding=>finding.source.page===pageNumber)
    const invalidated = new Set(before.map(findingKey))
    const drafts = Object.fromEntries(Object.entries(prior.drafts ?? {}).filter(([id])=>!invalidated.has(id)))
    const event:AuditEvent={
      id:crypto.randomUUID(),action:'OCR re-indexed',reviewer:reviewer || 'OCR',reason:endpoint==='vlm:local' ? 'In-browser VLM' : endpoint ? 'Hosted OCR' : 'Local OCR',saved,
      ocr:{page:pageNumber,before,after:findings(lines).filter(finding=>finding.source.page===pageNumber),
        invalidatedDrafts:Object.values(prior.drafts ?? {}).filter(draft=>invalidated.has(draft.findingId)).map(draft=>draft.id)},
    }
    return {...prior,lines,drafts,extractionRuns:{...prior.extractionRuns,[pageNumber]:run},ocrPages:[...new Set([...(prior.ocrPages??[]),pageNumber])],
      ocrUpdated:{...prior.ocrUpdated,[pageNumber]:saved},history:[...(prior.history ?? []),event]}
  }))!
}

export function indexedRegion(lines:Line[],page:number,box:Line['box']):Line | undefined {
  const inside = ([x0,y0,x1,y1]:Line['box']) => (x0+x1)/2>=box[0]&&(x0+x1)/2<=box[2]&&(y0+y1)/2>=box[1]&&(y0+y1)/2<=box[3]
  const matches=lines.filter(line=>line.page===page).flatMap(line=>{
    if(!line.words?.length)return inside(line.box)?[line]:[]
    const words=line.words.filter(word=>inside(word.box))
    return words.length?[{...line,text:words.map(word=>word.text).join(' ')}]:[]
  })
  return matches.length ? {page,box,extraction_run_id:matches[0].extraction_run_id,text:matches.map(line=>line.text).join(' ')} : undefined
}
