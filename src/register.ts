import {getDocument, Util} from 'pdfjs-dist'
export type Line = {page:number; text:string; box:[number,number,number,number]}
export type Figure = {id:string; label:string; amount:string; unit:string; period:string; note:string; source:Line; saved:string}
export type RecordFile = {id:string; name:string; pages:number; added:string; file:File; lines:Line[]; figures:Figure[]; ocrPages?:number[]}
type Header = Pick<RecordFile,'id'|'name'|'pages'|'added'> & {count:number}
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
export const list=()=>read<Header[]>('headers')
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
          const {name,pages,added,figures}=next
          headers.put({id,name,pages,added,count:figures.length})
        }else{files.delete(id);headers.delete(id)}
      }catch{tx.abort()}
    }
    tx.oncomplete=()=>resolve(next)
    tx.onabort=()=>reject(tx.error??new Error('Document changed or storage is unavailable. Reopen the library.'))
  })
}
export async function indexPdf(file:File,onProgress:(message:string)=>void):Promise<RecordFile>{
  if(file.size>50*1024*1024)throw Error('Choose a PDF smaller than 50 MB.')
  const bytes=await file.arrayBuffer()
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  const id=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')
  const existing=await get(id)
  if(existing)return existing
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
        lines.push({page:pageNumber,text:items.map(i=>i.text).join(' '),box})
      }
      page.cleanup()
    }
    const record={id,file,name:file.name,pages:doc.numPages,added:new Date().toISOString(),lines,ocrPages,figures:[]}
    return (await change(id,old=>old??record))!
  }finally{try{await worker?.terminate()}finally{await task.destroy()}}
}
export function download(record:RecordFile){
  const rows=[['Metric','Value','Unit','Period','Document','Page','Evidence','Notes','Reviewed UTC']]
  for(const f of record.figures)rows.push([f.label,f.amount,f.unit,f.period,record.name,String(f.source.page),f.source.text,f.note,f.saved])
  const csv=rows.map(row=>row.map((v,i)=>{
    if(i===1 && /^-?\d+(\.\d+)?$/.test(v))return v
    return '"'+(/^[\s]*[=+@-]/.test(v)?"'":"")+v.replaceAll('"','""')+'"'
  }).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=record.name.replace(/\.pdf$/i,'')+'-register.csv';a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export async function scanPage(record:RecordFile,pageNumber:number){
  const {startOCR,recognizePage}=await import('./ocr')
  const task=getDocument({data:await record.file.arrayBuffer(),standardFontDataUrl:'/pdf-fonts/'})
  try{
    const pdf=await task.promise
    const worker=await startOCR()
    try{
      const scanned=await recognizePage(await pdf.getPage(pageNumber),worker)
      if(!scanned.length)throw Error('No readable text found on this page.')
      return (await change(record.id,prior=>{
        if(!prior)throw Error()
        return {...prior,lines:[...prior.lines.filter(l=>l.page!==pageNumber),...scanned].sort((a,b)=>a.page-b.page),ocrPages:[...new Set([...(prior.ocrPages??[]),pageNumber])]}
      }))!
    }finally{await worker.terminate()}
  }finally{await task.destroy()}
}
