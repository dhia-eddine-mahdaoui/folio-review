import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import {indexPdf,change,type RecordFile,type Figure} from './register'

export async function backup(doc:RecordFile){
  const manifest={format:'folio-workpaper',version:1,id:doc.id,name:doc.name,figures:doc.figures}
  const bytes=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'document.pdf':new Uint8Array(await doc.file.arrayBuffer())},{level:0})
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
  const a=document.createElement('a');a.download=doc.name.replace(/\.pdf$/i,'')+'.folio';a.href=url;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function valid(f:Figure,pages:number){
  return f && ['id','label','amount','period','unit','note','saved'].every(k=>typeof f[k as keyof Figure]==='string') &&
    /^-?\d+(\.\d+)?$/.test(f.amount) && Number.isFinite(Date.parse(f.saved)) && f.source &&
    Number.isInteger(f.source.page)&&f.source.page>=1&&f.source.page<=pages&&typeof f.source.text==='string'&&
    Array.isArray(f.source.box)&&f.source.box.length===4&&f.source.box.every(Number.isFinite)
}
export async function restore(file:File,progress:(s:string)=>void){
  if(file.size>60*1024*1024)throw Error('This workpaper exceeds 60 MB.')
  const parts=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>
    entry.name==='manifest.json'?entry.originalSize<=5*1024*1024:entry.name==='document.pdf'&&entry.originalSize<=50*1024*1024})
  if(!parts['manifest.json']||!parts['document.pdf'])throw Error('Invalid Folio workpaper.')
  const m=JSON.parse(strFromU8(parts['manifest.json']))
  if(m.format!=='folio-workpaper'||m.version!==1||typeof m.name!=='string'||!Array.isArray(m.figures))throw Error('Unsupported Folio workpaper.')
  const bytes=new Uint8Array(parts['document.pdf'])
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
  if(hash!==m.id||!m.figures.every((f:Figure)=>valid(f,1000)))throw Error('Invalid document identity or figures.')
  const doc=await indexPdf(new File([bytes],m.name,{type:'application/pdf'}),progress)
  if(!m.figures.every((f:Figure)=>valid(f,doc.pages)))throw Error('Figure has an invalid page reference.')
  return (await change(doc.id,current=>{
    if(!current)throw Error()
    const merged=new Map(current.figures.map(f=>[f.id,f]))
    for(const f of m.figures as Figure[]){
      const prior=merged.get(f.id)
      if(!prior||Date.parse(f.saved)>Date.parse(prior.saved))merged.set(f.id,f)
    }
    return {...current,figures:[...merged.values()]}
  }))!
}
