import type {Finding} from './findings'
import type {RecordFile} from './register'
import {findingKey,findingStatus} from './review'

export type DraftChanges = {amount?:string; canonicalMetric?:string; note?:string}
export type AgentDraft = {id:string; workpaperId:string; findingId:string; run?:string; baseDecision?:string; created:string; changes:DraftChanges; rationale:string; agent:string}

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
  return {id:crypto.randomUUID(),workpaperId:doc.id,findingId,run:finding.source.extraction_run_id,
    baseDecision:doc.exclusions?.[findingId]?.saved,created:new Date().toISOString(),changes,rationale:input.rationale.trim(),agent}
}
