import {appendHistory,canonicalJson,digestJson,genesis,sha256,sourceHash,verifyHistory} from './audit'
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import {findingKey, priorities, type Assignment, type AuditEvent, type Exclusion} from './review'
import type {AgentDraft} from './agentDraft'
import type {Finding} from './findings'
import {indexPdf,change,get,type RecordFile,type Figure,type Line} from './register'
import {archiveKey,domainOrigin,ipOrigin,b64,newIv,newSalt,registerPasskey,signRoot,storedPasskey,unb64,assert,verifySignOff,type SignOff} from './passkey'

const maxManifestSize = 48 * 1024 * 1024

export type ReviewerProfile = {name:string; saved:string}

export async function encodeBackup(doc:RecordFile, reviewer?:ReviewerProfile) {
  const pdf = new Uint8Array(await doc.file.arrayBuffer())
  const history = await appendHistory(doc.history ?? [],sourceHash(doc.id))
  if (!await verifyHistory(history,sourceHash(doc.id))) throw Error('The activity hash chain is invalid.')
  const manifest = {format:'folio-workpaper',version:3,id:doc.id,reviewer,name:doc.name,figures:doc.figures,exclusions:doc.exclusions,sample:doc.sample,
    assignments:doc.assignments,drafts:doc.drafts,history,chain_head:history.at(-1)?.hash ?? genesis,extractionRuns:doc.extractionRuns,
    indexedLines:doc.lines,ocrPages:doc.ocrPages,ocrUpdated:doc.ocrUpdated}
  const encoded = strToU8(JSON.stringify({...manifest,manifest_sha256:await digestJson(manifest)}))
  if (encoded.length > maxManifestSize) throw Error('The workpaper exceeds the backup size limit.')
  return zipSync({'manifest.json':[encoded,{level:6}],'document.pdf':pdf},{level:0})
}

export async function backup(doc:RecordFile, reviewer?:ReviewerProfile){
  download(doc,await encodeBackup(doc,reviewer))
}

function download(doc:RecordFile, bytes:Uint8Array) {
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
  const a=document.createElement('a');a.download=doc.name.replace(/\.pdf$/i,'')+'.folio';a.href=url;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
type EncryptedHeader = {format:'folio-encrypted'; version:1; cipher:'AES-256-GCM'; kdf:'WebAuthn-PRF/HKDF-SHA-256'; credential_id:string; prf_salt:string; iv:string; name:string}
const encryptedName = 'folio-encrypted.json'

// Signs the current audit-chain root with the reviewer's passkey, appends a Sign-Off event and exports the workpaper.
// When the passkey supports PRF, the archive is encrypted with an AES-256-GCM key derived from it.
export async function signAndSeal(doc:RecordFile, reviewer:string, profile?:ReviewerProfile, encrypt = true) {
  const passkey = storedPasskey() ?? await registerPasskey(reviewer)
  const history = await appendHistory(doc.history ?? [],sourceHash(doc.id))
  const root = history.at(-1)?.hash ?? genesis
  const salt = encrypt && passkey.prf ? newSalt() : undefined
  const {signoff,prf} = await signRoot(passkey,root,history.length,salt)
  const sealed = (await change(doc.id,prior=>{
    if (!prior || (prior.history?.at(-1)?.hash ?? genesis)!==root) throw Error('The workpaper changed while it was being signed. Sign again.')
    return {...prior,history:[...(prior.history ?? []),{id:crypto.randomUUID(),action:'Sign-Off',reviewer,saved:new Date().toISOString(),
      reason:`Hardware passkey sign-off (${root.slice(0,6)}…${root.slice(-4)})`,signoff}]}
  }))!
  let bytes = await encodeBackup(sealed,profile)
  const encrypted = !!(salt && prf)
  if (encrypted) {
    const iv = newIv()
    const header:EncryptedHeader = {format:'folio-encrypted',version:1,cipher:'AES-256-GCM',kdf:'WebAuthn-PRF/HKDF-SHA-256',
      credential_id:passkey.credentialId,prf_salt:b64(salt),iv:b64(iv),name:doc.name}
    const aad = strToU8(canonicalJson(header))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await archiveKey(prf,salt),bytes))
    bytes = zipSync({[encryptedName]:[aad,{level:6}],'payload.bin':[ciphertext,{level:0}]},{level:0})
  }
  download(sealed,bytes)
  return {doc:sealed,encrypted,root,prf:passkey.prf}
}

async function decryptArchive(parts:Record<string,Uint8Array>, progress:(s:string)=>void) {
  let header:EncryptedHeader
  try {header = JSON.parse(strFromU8(parts[encryptedName]))} catch {throw Error('Invalid encrypted Folio workpaper.')}
  if (header?.format!=='folio-encrypted' || header.version!==1 || header.cipher!=='AES-256-GCM' || typeof header.credential_id!=='string' ||
    typeof header.prf_salt!=='string' || typeof header.iv!=='string' || !parts['payload.bin']) throw Error('Unsupported encrypted Folio workpaper.')
  progress('Unlock with your passkey')
  if (ipOrigin()) throw Error('Encrypted workpapers open with a passkey, which needs Folio at '+domainOrigin()+' rather than an IP address.')
  const salt = unb64(header.prf_salt)
  const {prf} = await assert(header.credential_id,crypto.getRandomValues(new Uint8Array(32)),salt)
  if (!prf) throw Error('This passkey cannot derive the archive key (PRF unsupported).')
  try {
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(header.iv),additionalData:strToU8(canonicalJson(header))},
      await archiveKey(prf,salt),new Uint8Array(parts['payload.bin'])))
  } catch {
    throw Error('Decryption failed. The archive was modified or belongs to a different passkey.')
  }
}

function validSignOff(signoff:SignOff) {
  return signoff && signoff.algorithm==='ES256' && Number.isSafeInteger(signoff.events) && /^[0-9a-f]{64}$/.test(signoff.signed_root) &&
    ['credential_id','public_key','authenticator_data','client_data_json','signature'].every(key=>typeof signoff[key as keyof SignOff]==='string')
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
        field==='canonicalMetric' ? !!value.trim() && value.length<=500 : field==='unit' || field==='period' ? !!value.trim() && value.length<=120 : field==='note' && value.length<=4000))
}
function validEvent(event:AuditEvent,pages:number) {
  if (!event || ![event.id,event.action,event.reviewer,event.reason,event.saved].every(value=>typeof value==='string') ||
    !Number.isFinite(Date.parse(event.saved)) || event.original!==undefined && !validFinding(event.original,pages)) return false
  if (event.ocr!==undefined && (!event.ocr || !Number.isInteger(event.ocr.page) || event.ocr.page<1 || event.ocr.page>pages ||
    ![event.ocr.before,event.ocr.after].every(entries=>Array.isArray(entries) &&
      entries.every(finding=>validFinding(finding,pages) && finding.source.page===event.ocr!.page)))) return false
  if (event.draft!==undefined && !validDraft(event.draft)) return false
  if (event.signoff!==undefined && !validSignOff(event.signoff)) return false
  if (event.routing!==undefined && !validAssignment(event.routing,pages)) return false
  return [event.before,event.after].every(value => value === undefined || (value && typeof value === 'object' &&
    ('amount' in value ? valid(value,pages) : 'assignee' in value ? validAssignment(value,pages) : validDecision(value,pages))))
}

export async function restore(file:File,progress:(s:string)=>void){
  if(file.size>100*1024*1024)throw Error('This workpaper exceeds 100 MB.')
  let archive = new Uint8Array(await file.arrayBuffer())
  const outer = unzipSync(archive,{filter:entry=>entry.name===encryptedName || entry.name==='payload.bin'})
  const encrypted = !!outer[encryptedName]
  if (encrypted) archive = await decryptArchive(outer,progress)
  const {doc,reviewer} = await restoreArchive(archive,archive.length,progress)
  return {doc,reviewer,encrypted}
}

async function restoreArchive(archive:Uint8Array,size:number,progress:(s:string)=>void):Promise<{doc:RecordFile;reviewer?:ReviewerProfile}>{
  if(size>100*1024*1024)throw Error('This workpaper exceeds 100 MB.')
  const parts=unzipSync(archive,{filter:entry=>
    entry.name==='manifest.json'?entry.originalSize<=maxManifestSize:entry.name==='document.pdf'&&entry.originalSize<=50*1024*1024})
  if(!parts['manifest.json']||!parts['document.pdf'])throw Error('Invalid Folio workpaper.')
  const m=JSON.parse(strFromU8(parts['manifest.json']))
  if(m.format!=='folio-workpaper'||![1,2,3].includes(m.version)||typeof m.name!=='string'||!Array.isArray(m.figures))throw Error('Unsupported Folio workpaper.')
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
  if (m.reviewer!==undefined && (m.version<3 || !m.reviewer || typeof m.reviewer.name!=='string' || !m.reviewer.name.trim() ||
    m.reviewer.name.length>120 || typeof m.reviewer.saved!=='string' || !Number.isFinite(Date.parse(m.reviewer.saved)))) throw Error('Invalid reviewer profile.')
  if (m.version>=2) {
    const {manifest_sha256,...payload} = m
    if (manifest_sha256!==await digestJson(payload) || m.chain_head!==(history.at(-1)?.hash ?? genesis) ||
      !await verifyHistory(history,hash)) throw Error('SHA-256 verification failed. This backup has been modified.')
    for (const [index,event] of history.entries()) {
      if (!event.signoff) continue
      if (event.signoff.signed_root!==(history[index-1]?.hash ?? genesis) || event.signoff.events!==index || !await verifySignOff(event.signoff,null)) {
        throw Error('Passkey signature verification failed. This backup has been modified.')
      }
    }
  } else if (m.chain_head!==undefined || m.manifest_sha256!==undefined || indexedLines!==undefined || history.some(event=>event.hash!==undefined || event.prev_hash!==undefined || event.source_pdf_sha256!==undefined)) {
    throw Error('Invalid legacy audit data.')
  }
  const existing = await get(m.id)
  const doc=existing ?? await indexPdf(new File([bytes],m.name,{type:'application/pdf'}),progress,{
    sample:m.sample===true,restore:{lines:indexedLines,ocrPages:m.ocrPages,runs:m.extractionRuns},
  })
  if(!validReview(doc.pages))throw Error('Review data has an invalid page reference.')
  const restored = (await change(doc.id,previous=>{
    if (existing && !previous) throw Error('The workpaper was removed while the backup was being restored.')
    const current = previous ?? doc
    if (m.version>=2) {
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
  return {doc:restored,reviewer:m.reviewer}
}

function mergeEntries<T extends {saved:string}>(current:Record<string,T>|undefined,incoming:[string,T][]) {
  const merged = {...current}
  for (const [key,entry] of incoming) {
    const existing = merged[key]
    if (!existing || Date.parse(entry.saved)>Date.parse(existing.saved)) merged[key] = entry
  }
  return merged
}
