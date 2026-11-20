import type {Finding} from './findings'
import type {RecordFile} from './register'
import {findingKey,findingStatus} from './review'

export type DraftChanges = {amount?:string; canonicalMetric?:string; note?:string; unit?:string; period?:string}
export type AgentDraft = {id:string; workpaperId:string; findingId:string; run?:string; baseDecision?:string; created:string; changes:DraftChanges; rationale:string; agent:string}

// Findings whose scale or period cannot be read from the source need the user's confirmation before an agent drafts on them.
export function ambiguousContext(finding:Finding) {
  const flags = finding.review_flags ?? []
  const fields = [...(!finding.unit || flags.some(flag=>['missing_unit','missing_scale','missing_currency'].includes(flag)) ? ['unit'] : []),
    ...(!finding.period || flags.includes('missing_period') ? ['period'] : [])]
  return fields
}

export function createDraft(doc:RecordFile,finding:Finding, input:Record<string,unknown>, agent:string):AgentDraft {
  const findingId = findingKey(finding)
  const status = findingStatus(finding,doc.figures,doc.exclusions)
  if (status==='Verified' || status==='Excluded') throw Error('This finding is closed.')
  const changes = input.changes
  if (!changes || typeof changes!=='object' || Array.isArray(changes) || !Object.keys(changes).length) throw Error('Provide one or more editable fields.')
  for (const [key,value] of Object.entries(changes)) {
    if (typeof value!=='string' || !['amount','canonicalMetric','note'].includes(key) ||
      key==='amount' && (!/^-?\d+(\.\d+)?$/.test(value) || value.length>80) ||
      key==='canonicalMetric' && (!value.trim() || value.length>500) ||
      key==='note' && value.length>4000) throw Error('Invalid draft change.')
  }
  if (typeof input.rationale!=='string' || !input.rationale.trim() || input.rationale.length>2000) throw Error('Provide a rationale of up to 2,000 characters.')
  const context = input.context as Record<string,unknown> | undefined
  const confirmed:DraftChanges = {}
  for (const field of ambiguousContext(finding) as ('unit'|'period')[]) {
    const value = context?.[field]
    if (typeof value!=='string' || !value.trim() || value.length>120) throw Error('Confirm the '+field+' before staging a draft.')
    confirmed[field] = value.trim()
  }
  return {id:crypto.randomUUID(),workpaperId:doc.id,findingId,run:finding.source.extraction_run_id,
    baseDecision:doc.exclusions?.[findingId]?.saved,created:new Date().toISOString(),changes:{...changes as DraftChanges,...confirmed},rationale:input.rationale.trim(),agent}
}
