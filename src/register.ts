import {findings} from './findings'
import {findingStatus, workpaperFindings, type Assignment, type AuditEvent, type Exclusion} from './review'
import type {Finding} from './findings'
type Word = {text:string; start:number; end:number; box:[number,number,number,number]}
export type Line = {words?:Word[]; column?:number;page:number; text:string; box:[number,number,number,number]; confidence?:number; ocr?:boolean}
export type Figure = {id:string; label:string; amount:string; unit:string; period:string; note:string; source:Line; saved:string; findingKey?:string; original?:Finding; reviewer?:string; changeReason?:string}
export type RecordFile = {id:string; name:string; pages:number; added:string; file:File; lines:Line[]; figures:Figure[]; ocrPages?:number[]; ocrUpdated?:Record<number,string>; sample?:boolean; exclusions?:Record<string, Exclusion>; assignments?:Record<string,Assignment>; history?:AuditEvent[]}
export type Header = Pick<RecordFile,'id'|'name'|'pages'|'added'|'sample'> & {
  count: number
  review?: {total: number; pending: number; unresolved?: number; scans?: number}
}

function summarize(record: RecordFile): Header {
  const {id, name, pages, added, figures, lines, exclusions, sample} = record
  const proposed = workpaperFindings(findings(lines), figures, exclusions, record.assignments)
  const statuses = proposed.map(finding => findingStatus(finding, figures, exclusions))
  const pending = statuses.filter(status => status === 'To review').length
  const unresolved = statuses.filter(status => status === 'On hold' || status === 'Escalated').length
  const scans = (record.ocrPages ?? []).length
  return {id, name, pages, added, sample, count: figures.length, review: {total: proposed.length, pending, unresolved, scans}}
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
export async function list() {
  const headers = await read<Header[]>('headers')
  const records: Header[] = []
  for (const header of headers) {
    // Older libraries have no cached review counts. Read their original records.
    const current = header.review?.unresolved !== undefined ? header : await get(header.id)
    if (current) records.push('file' in current ? summarize(current) : current)
  }
  return records
}
export const get=(id:string)=>read<RecordFile>('files',id)
export async function change(id:string,update:(previous?:RecordFile)=>RecordFile|undefined){
  const db=await database()
  return new Promise<RecordFile|undefined>((resolve,reject)=>{
    const tx=db.transaction(['files','headers'],'readwrite'), files=tx.objectStore('files'), headers=tx.objectStore('headers')
    let next:RecordFile|undefined
    const request=files.get(id)
    request.onsuccess=()=>{
      try{
        next=update(request.result)
        if(next){
          files.put(next)
          headers.put(summarize(next))
        }else{files.delete(id);headers.delete(id)}
      }catch{tx.abort()}
    }
    tx.oncomplete=()=>resolve(next)
    tx.onabort=()=>reject(tx.error??new Error('Document changed or storage is unavailable. Reopen the library.'))
  })
}
export async function indexPdf(file:File,onProgress:(message:string)=>void, sample = false):Promise<RecordFile>{
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
    const record={id,file,name:file.name,pages:doc.numPages,added:new Date().toISOString(),lines,ocrPages,sample,figures:[]}
    return (await change(id,old=>old??record))!
  }finally{try{await worker?.terminate()}finally{await task.destroy()}}
}
export function download(record: RecordFile) {
  downloadRegister(record.figures.map(figure => ({figure, document: record.name})), record.name.replace(/\.pdf$/i, '') + '-register.csv')
}

export function downloadRegister(entries: {figure: Figure; document: string}[], filename = 'folio-register.csv') {
  const rows=[['Metric','Value','Unit','Period','Document','Page','Evidence','Notes','Reviewed UTC','Original value','Original unit','Original period','Reviewer ID','Change reason']]
  for(const {figure:f, document} of entries)rows.push([f.label,f.amount,f.unit,f.period,document,String(f.source.page),f.source.text,f.note,f.saved,f.original?.amount??'',f.original?.unit??'',f.original?.period??'',f.reviewer??'',f.changeReason??''])
  const csv=rows.map(row=>row.map((v,i)=>{
    if(i===1 && /^-?\d+(\.\d+)?$/.test(v))return v
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
    const lines=[...prior.lines.filter(l=>l.page!==pageNumber),...scanned].sort((a,b)=>a.page-b.page)
    const saved=new Date().toISOString()
    const event:AuditEvent={
      id:crypto.randomUUID(),action:'OCR retry',reviewer:reviewer || 'OCR',reason:endpoint ? 'Hosted OCR' : 'Local OCR',saved,
      ocr:{page:pageNumber,before:findings(prior.lines).filter(f=>f.source.page===pageNumber),after:findings(lines).filter(f=>f.source.page===pageNumber)},
    }
    return {...prior,lines,ocrPages:[...new Set([...(prior.ocrPages??[]),pageNumber])],
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
  return matches.length ? {page,box,text:matches.map(line=>line.text).join(' ')} : undefined
}
