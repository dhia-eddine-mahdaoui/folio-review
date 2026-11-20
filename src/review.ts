import type {AgentDraft} from './agentDraft'
import type {Finding} from './findings'
import type {Figure} from './register'
import type {SignOff} from './passkey'

export const defaultReasons = ['Unreadable Scan', 'Arithmetic Variance', 'Duplicate Page', 'Out of Period', 'Other']
export const priorities = ['Low', 'Normal', 'High'] as const
export type Priority = typeof priorities[number]
export type Disposition = 'Excluded' | 'On hold' | 'Escalated'
export type Exclusion = {finding: Finding; reason: string | null; saved: string; status?: Disposition; code?: string; reviewer?: string}
export type Assignment = {assignee: string; priority: Priority; saved: string; finding: Finding}
export type AuditEvent = {
  id: string; action: string; reviewer: string; reason: string; saved: string
  draft?: AgentDraft
  routing?: Assignment
  hash?:string; prev_hash?:string; source_pdf_sha256?:string
  original?: Finding
  before?: Figure | Exclusion | Assignment
  after?: Figure | Exclusion | Assignment
  ocr?: {page:number; before:Finding[]; after:Finding[]; invalidatedDrafts?:string[]}
  signoff?: SignOff
}

export function findingKey(finding: Finding) {
  const {source, label, amount, period, unit} = finding
  return JSON.stringify([source.page, source.rawText ?? source.text, source.column ?? null, label, amount, period, unit, ...(finding.manualFigureId ? [finding.manualFigureId] : [])])
}

export function reviewedFinding(finding: Finding, figures: Figure[]) {
  if (finding.manualFigureId) return figures.find(figure=>figure.id===finding.manualFigureId)
  const key = findingKey(finding)
  return figures.find(figure => figure.findingKey !== undefined
    ? figure.findingKey === key
    : figure.source.page === finding.source.page && figure.source.text === finding.source.text &&
      figure.source.column === finding.source.column)
}

export function findingStatus(finding: Finding, figures: Figure[], exclusions?: Record<string, Exclusion>) {
  if (reviewedFinding(finding, figures)) return 'Verified'
  const decision = exclusions?.[findingKey(finding)]
  return decision?.reason ? decision.status === 'On hold' ? 'On Hold' : decision.status ?? 'Excluded' : 'Pending'
}

export function workpaperFindings(
  proposed: Finding[], figures: Figure[], decisions?: Record<string, Exclusion>, assignments?: Record<string, Assignment>,
) {
  const current = new Map(proposed.map(finding => [findingKey(finding), finding]))
  for (const figure of figures) {
    if (figure.findingKey ? current.has(figure.findingKey) : proposed.some(finding=>reviewedFinding(finding,[figure]))) continue
    const original = figure.original ?? {...figure,source:figure.source,manualFigureId:figure.id}
    const key = findingKey(original)
    if (!current.has(key)) current.set(key,original)
  }
  for (const [key, entry] of Object.entries({...assignments, ...decisions})) {
    if (!current.has(key) && (!('reason' in entry) || entry.reason || assignments?.[key])) current.set(key, entry.finding)
  }
  return [...current.values()].sort((a,b) => a.source.page - b.source.page || a.source.box[1] - b.source.box[1] ||
    (a.source.column ?? 0) - (b.source.column ?? 0))
}

export const statuses = ['Pending', 'On Hold', 'Escalated', 'Verified', 'Excluded'] as const
export type Status = typeof statuses[number]
export function queueCounts(findings:Finding[], figures:Figure[], exclusions?:Record<string,Exclusion>) {
  const counts:Record<Status,number> = {Pending:0,'On Hold':0,Escalated:0,Verified:0,Excluded:0}
  for (const finding of findings) counts[findingStatus(finding,figures,exclusions)]++
  return counts
}
