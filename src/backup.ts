import {appendHistory,digestJson,genesis,sha256,sourceHash,verifyHistory} from './audit'
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import {findingKey, priorities, type Assignment, type AuditEvent, type Exclusion} from './review'
import type {AgentDraft} from './agentDraft'
import type {Finding} from './findings'
import {indexPdf,change,get,type RecordFile,type Figure,type Line} from './register'

const maxManifestSize = 48 * 1024 * 1024

export async function encodeBackup(doc:RecordFile) {
  const pdf = new Uint8Array(await doc.file.arrayBuffer())
  const history = await appendHistory(doc.history ?? [],sourceHash(doc.id))
  if (!await verifyHistory(history,sourceHash(doc.id))) throw Error('The activity hash chain is invalid.')
  const manifest = {format:'folio-workpaper',version:2,id:doc.id,name:doc.name,figures:doc.figures,exclusions:doc.exclusions,sample:doc.sample,
    assignments:doc.assignments,drafts:doc.drafts,history,chain_head:history.at(-1)?.hash ?? genesis,extractionRuns:doc.extractionRuns,
    indexedLines:doc.lines,ocrPages:doc.ocrPages,ocrUpdated:doc.ocrUpdated}
  const encoded = strToU8(JSON.stringify({...manifest,manifest_sha256:await digestJson(manifest)}))
  if (encoded.length > maxManifestSize) throw Error('The workpaper exceeds the backup size limit.')
  return zipSync({'manifest.json':[encoded,{level:6}],'document.pdf':pdf},{level:0})
}

export async function backup(doc:RecordFile){
  const bytes = await encodeBackup(doc)
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
  const a=document.createElement('a');a.download=doc.name.replace(/\.pdf$/i,'')+'.folio';a.href=url;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function validSource(source: Figure['source'], pages: number) {
  return source && Number.isInteger(source.page) && source.page >= 1 && source.page <= pages &&
    typeof source.text === 'string' && Array.isArray(source.box) &&
    source.box.length === 4 && source.box.every(Number.isFinite) &&
    (source.ocr === undefined || typeof source.ocr === 'boolean') &&
    (source.confidence === undefined || Number.isFinite(source.confidence) && source.confidence >= 0 && source.confidence <= 100) &&
    (source.words === undefined || Array.isArray(source.words) && source.words.every(word => word && typeof word.text === 'string' &&
      Number.isSafeInteger(word.start) && Number.isSafeInteger(word.end) && Array.isArray(word.box) && word.box.length === 4 && word.box.every(Number.isFinite))) &&
    (source.column === undefined || Number.isInteger(source.column)) &&
    (source.rawText===undefined || typeof source.rawText==='string') &&
    (source.extraction_run_id===undefined || typeof source.extraction_run_id==='string') &&
    (source.layoutText===undefined || typeof source.layoutText==='string')
}

function valid(f:Figure,pages:number){
  return f && ['id','label','amount','period','unit','note','saved'].every(k=>typeof f[k as keyof Figure]==='string') &&
    /^-?\d+(\.\d+)?$/.test(f.amount) && Number.isFinite(Date.parse(f.saved)) &&
    (f.findingKey === undefined || typeof f.findingKey === 'string') &&
    (f.verbatimLabel===undefined || typeof f.verbatimLabel==='string') &&
    (f.reviewer === undefined || typeof f.reviewer === 'string') &&
    (f.changeReason === undefined || typeof f.changeReason === 'string') &&
    (f.original === undefined || validFinding(f.original,pages)) && validSource(f.source,pages)
}
function validFinding(finding:Finding,pages:number) {
  return finding && [finding.label, finding.amount, finding.period, finding.unit].every(value => typeof value === 'string') &&
    (finding.normalized_amount === undefined || finding.normalized_amount === null || typeof finding.normalized_amount === 'string') &&
    (finding.review_flags === undefined || Array.isArray(finding.review_flags) && finding.review_flags.every(flag=>typeof flag==='string')) &&
    validSource(finding.source,pages)
}
function validDecision(decision:Exclusion,pages:number) {
  return decision && typeof decision.saved === 'string' && Number.isFinite(Date.parse(decision.saved)) &&
    (decision.reason === null || (typeof decision.reason === 'string' && !!decision.reason.trim())) &&
    (decision.status === undefined || ['Excluded','On hold','Escalated'].includes(decision.status)) &&
    (decision.code === undefined || typeof decision.code === 'string') &&
    (decision.reviewer === undefined || typeof decision.reviewer === 'string') && validFinding(decision.finding,pages)
}
function validAssignment(entry:Assignment,pages:number) {
  return entry && typeof entry.assignee === 'string' && priorities.includes(entry.priority) &&
    typeof entry.saved === 'string' && Number.isFinite(Date.parse(entry.saved)) && validFinding(entry.finding,pages)
}
function validDraft(draft:AgentDraft,id?:string) {
  return draft && [draft.id,draft.findingId,draft.workpaperId,draft.created,draft.rationale,draft.agent].every(value=>typeof value==='string') &&
    (!id || draft.workpaperId===id) && Number.isFinite(Date.parse(draft.created)) &&
    (draft.run===undefined || typeof draft.run==='string') &&
    (draft.baseDecision===undefined || typeof draft.baseDecision==='string') &&
    draft.changes && !Array.isArray(draft.changes) && typeof draft.changes==='object' && !!Object.keys(draft.changes).length &&
    Object.entries(draft.changes).every(([field,value])=>typeof value==='string' &&
      (field==='amount' ? /^-?\d+(\.\d+)?$/.test(value) && value.length<=80 :
        field==='canonicalMetric' ? !!value.trim() && value.length<=500 : field==='note' && value.length<=4000))
}
function validEvent(event:AuditEvent,pages:number) {
  if (!event || ![event.id,event.action,event.reviewer,event.reason,event.saved].every(value=>typeof value==='string') ||
    !Number.isFinite(Date.parse(event.saved)) || event.original!==undefined && !validFinding(event.original,pages)) return false
  if (event.ocr!==undefined && (!event.ocr || !Number.isInteger(event.ocr.page) || event.ocr.page<1 || event.ocr.page>pages ||
    ![event.ocr.before,event.ocr.after].every(entries=>Array.isArray(entries) &&
      entries.every(finding=>validFinding(finding,pages) && finding.source.page===event.ocr!.page)))) return false
  if (event.draft!==undefined && !validDraft(event.draft)) return false
  if (event.routing!==undefined && !validAssignment(event.routing,pages)) return false
  return [event.before,event.after].every(value => value === undefined || (value && typeof value === 'object' &&
    ('amount' in value ? valid(value,pages) : 'assignee' in value ? validAssignment(value,pages) : validDecision(value,pages))))
}

export async function restore(file:File,progress:(s:string)=>void){
  if(file.size>100*1024*1024)throw Error('This workpaper exceeds 100 MB.')
  const parts=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>
    entry.name==='manifest.json'?entry.originalSize<=maxManifestSize:entry.name==='document.pdf'&&entry.originalSize<=50*1024*1024})
  if(!parts['manifest.json']||!parts['document.pdf'])throw Error('Invalid Folio workpaper.')
  const m=JSON.parse(strFromU8(parts['manifest.json']))
  if(m.format!=='folio-workpaper'||![1,2].includes(m.version)||typeof m.name!=='string'||!Array.isArray(m.figures))throw Error('Unsupported Folio workpaper.')
  if ([m.exclusions,m.assignments,m.ocrUpdated,m.extractionRuns,m.drafts].some(value=>value!==undefined && (!value || typeof value!=='object' || Array.isArray(value))) ||
    [m.history,m.ocrLines,m.indexedLines,m.ocrPages].some(value=>value!==undefined && !Array.isArray(value))) {
    throw Error('Invalid review decisions.')
  }
  const exclusions = Object.entries<Exclusion>(m.exclusions ?? {})
  const assignments = Object.entries<Assignment>(m.assignments ?? {})
  const indexedLines:Line[] | undefined = m.indexedLines
  const drafts = Object.entries<AgentDraft>(m.drafts ?? {})
  const history:AuditEvent[] = m.history ?? []
  const ocrLines:Line[] = m.ocrLines ?? []
  const ocrUpdated:Record<number,string> = m.ocrUpdated ?? {}
  const validReview = (pages:number) => m.figures.every((f:Figure)=>valid(f,pages)) &&
    exclusions.every(([key,decision])=>validDecision(decision,pages)&&findingKey(decision.finding)===key) &&
    drafts.every(([key,draft])=>validDraft(draft,m.id) && draft.findingId===key) &&
    assignments.every(([key,entry])=>validAssignment(entry,pages)&&findingKey(entry.finding)===key) &&
    Object.entries(m.extractionRuns ?? {}).every(([page,run])=>/^[1-9]\d*$/.test(page) && Number(page)<=pages && typeof run==='string') &&
    (m.ocrPages ?? []).every((page:unknown)=>typeof page==='number' && Number.isInteger(page) && page>=1 && page<=pages) &&
    (indexedLines ?? []).every(line=>validSource(line,pages)) &&
    history.every(event=>validEvent(event,pages)) && ocrLines.every(line=>validSource(line,pages)) &&
    Object.entries(ocrUpdated).every(([page,time])=>/^[1-9]\d*$/.test(page) && Number(page)<=pages &&
      typeof time==='string' && Number.isFinite(Date.parse(time)))
  const bytes=new Uint8Array(parts['document.pdf'])
  const hash = await sha256(bytes)
  if((m.sample === true ? 'sample-' : '')+hash!==m.id||!validReview(1000))throw Error('Invalid document identity or review data.')
  if (m.version===2) {
    const {manifest_sha256,...payload} = m
    if (manifest_sha256!==await digestJson(payload) || m.chain_head!==(history.at(-1)?.hash ?? genesis) ||
      !await verifyHistory(history,hash)) throw Error('SHA-256 verification failed. This backup has been modified.')
  } else if (m.chain_head!==undefined || m.manifest_sha256!==undefined || indexedLines!==undefined || history.some(event=>event.hash!==undefined || event.prev_hash!==undefined || event.source_pdf_sha256!==undefined)) {
    throw Error('Invalid legacy audit data.')
  }
  const existing = await get(m.id)
  const doc=existing ?? await indexPdf(new File([bytes],m.name,{type:'application/pdf'}),progress,{
    sample:m.sample===true,restore:{lines:indexedLines,ocrPages:m.ocrPages,runs:m.extractionRuns},
  })
  if(!validReview(doc.pages))throw Error('Review data has an invalid page reference.')
  return (await change(doc.id,previous=>{
    if (existing && !previous) throw Error('The workpaper was removed while the backup was being restored.')
    const current = previous ?? doc
    if (m.version===2) {
      const local = current.history ?? []
      const shared = Math.min(local.length,history.length)
      if (local.slice(0,shared).some((event,index)=>event.hash!==history[index].hash)) {
        throw Error('This backup belongs to a different audit history. Open it in a separate browser profile.')
      }
      if (local.length>history.length) return current
      const extractionRuns = m.extractionRuns ?? {}
      const recovered = new Set(ocrLines.map(line=>line.page))
      return {...current,figures:m.figures,exclusions:m.exclusions,assignments:m.assignments,drafts:m.drafts,history,extractionRuns,
        lines:indexedLines ?? [...current.lines.filter(line=>!recovered.has(line.page)).map(line=>({...line,extraction_run_id:extractionRuns[line.page]})),
          ...ocrLines].sort((a,b)=>a.page-b.page),ocrPages:m.ocrPages ?? [...recovered],ocrUpdated}
    }
    const merged=new Map(current.figures.map(f=>[f.id,f]))
    for(const f of m.figures as Figure[]){
      const prior=merged.get(f.id)
      if(!prior||Date.parse(f.saved)>Date.parse(prior.saved))merged.set(f.id,f)
    }
    const ledger = new Map([...(current.history ?? []),...history.filter(event=>!current.history?.some(prior=>prior.id===event.id))].map(event=>[event.id,event]))
    for (const event of ledger.values()) {
      if (event.action!=='Delete figure' || !event.before || !('amount' in event.before)) continue
      const saved = merged.get(event.before.id)
      if (saved && Date.parse(saved.saved)<=Date.parse(event.saved)) merged.delete(saved.id)
    }
    const retained = new Map<string,Figure>()
    for (const figure of merged.values()) {
      const key = figure.findingKey ?? figure.id
      const existing = retained.get(key)
      if (!existing || Date.parse(figure.saved)>Date.parse(existing.saved)) retained.set(key,figure)
    }
    const scanned = new Set(current.ocrPages ?? [])
    const recovered = ocrLines.filter(({page})=>!scanned.has(page) || !existing && !current.ocrUpdated?.[page] ||
      Date.parse(ocrUpdated[page] ?? '') > Date.parse(current.ocrUpdated?.[page] ?? current.added))
    const recoveredPages = new Set(recovered.map(line=>line.page))
    const timestamps = {...current.ocrUpdated}
    const extractionRuns = {...current.extractionRuns}
    for (const page of recoveredPages) {
      if (ocrUpdated[page]) timestamps[page] = ocrUpdated[page]
      extractionRuns[page] = crypto.randomUUID()
    }
    return {...current,extractionRuns,figures:[...retained.values()],exclusions:mergeEntries(current.exclusions,exclusions),
      assignments:mergeEntries(current.assignments,assignments),history:[...ledger.values()],
      lines:[...current.lines.filter(line=>!recoveredPages.has(line.page)),...recovered.map(line=>({...line,extraction_run_id:extractionRuns[line.page]}))].sort((a,b)=>a.page-b.page),
      ocrPages:[...new Set([...scanned,...recoveredPages])],ocrUpdated:timestamps}
  }))!
}

function mergeEntries<T extends {saved:string}>(current:Record<string,T>|undefined,incoming:[string,T][]) {
  const merged = {...current}
  for (const [key,entry] of incoming) {
    const existing = merged[key]
    if (!existing || Date.parse(entry.saved)>Date.parse(existing.saved)) merged[key] = entry
  }
  return merged
}
