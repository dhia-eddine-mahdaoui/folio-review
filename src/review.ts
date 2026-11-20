import type {Finding} from './findings'
import type {Figure} from './register'

export const defaultReasons = ['Unreadable Scan', 'Arithmetic Variance', 'Duplicate Page', 'Out of Period', 'Other']
export const priorities = ['Low', 'Normal', 'High'] as const
export type Priority = typeof priorities[number]
export type Disposition = 'Excluded' | 'On hold' | 'Escalated'
export type Exclusion = {finding: Finding; reason: string | null; saved: string; status?: Disposition; code?: string; reviewer?: string}
export type Assignment = {assignee: string; priority: Priority; saved: string; finding: Finding}
export type AuditEvent = {
  id: string; action: string; reviewer: string; reason: string; saved: string
  original?: Finding
  before?: Figure | Exclusion | Assignment
  after?: Figure | Exclusion | Assignment
  ocr?: {page:number; before:Finding[]; after:Finding[]}
}

export function findingKey(finding: Finding) {
  const {source, label, amount, period, unit} = finding
  return JSON.stringify([source.page, source.text, source.column ?? null, label, amount, period, unit])
}

export function reviewedFinding(finding: Finding, figures: Figure[]) {
  const key = findingKey(finding)
  return figures.find(figure => figure.findingKey !== undefined
    ? figure.findingKey === key
    : figure.source.page === finding.source.page && figure.source.text === finding.source.text &&
      figure.source.column === finding.source.column)
}

export function findingStatus(finding: Finding, figures: Figure[], exclusions?: Record<string, Exclusion>) {
  if (reviewedFinding(finding, figures)) return 'Verified'
  const decision = exclusions?.[findingKey(finding)]
  return decision?.reason ? decision.status ?? 'Excluded' : 'To review'
}

export function workpaperFindings(
  proposed: Finding[], figures: Figure[], decisions?: Record<string, Exclusion>, assignments?: Record<string, Assignment>,
) {
  const current = new Map(proposed.map(finding => [findingKey(finding), finding]))
  for (const figure of figures) if (figure.original && !current.has(findingKey(figure.original))) {
    current.set(findingKey(figure.original), figure.original)
  }
  for (const [key, entry] of Object.entries({...assignments, ...decisions})) {
    if (!current.has(key) && (!('reason' in entry) || entry.reason || assignments?.[key])) current.set(key, entry.finding)
  }
  return [...current.values()].sort((a,b) => a.source.page - b.source.page || a.source.box[1] - b.source.box[1] ||
    (a.source.column ?? 0) - (b.source.column ?? 0))
}
