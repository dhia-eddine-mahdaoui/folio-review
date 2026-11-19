export type Evidence = {
  page: number
  quote: string
  box: [number, number, number, number]
  value: string
  basis: string
}
export type Metric = {
  id: string
  name: string
  unit: string
  period: string
  status: 'ready' | 'conflict' | 'limited' | 'missing'
  reason: string
  evidence: Evidence[]
}
export type Review = {
  title: string
  filename: string
  pages: number
  metrics: Metric[]
  text_pages: number
}
export type Decision = {
  status: 'Approved' | 'Excluded'
  source?: Evidence
  note: string
  timestamp: string
}
export type Decisions = Record<string, Decision>

export const samplePdf = '/demo/northfield-fy2025.pdf'
const storageKey = 'folio-demo-decisions-v1'

export function loadDecisions(): Decisions {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export function saveDecisions(decisions: Decisions) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(decisions))
  } catch {
    // The review remains usable for this session if browser storage is disabled.
  }
}

export function formatAmount(value: string) {
  const [integer, decimals] = value.split('.')
  return `£${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimals === undefined ? '' : '.' + decimals}m`
}

function escapeCsv(value: string) {
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function exportReview(review: Review, decisions: Decisions) {
  const header = ['Metric', 'Period', 'Amount', 'Unit', 'Decision', 'Source PDF', 'Page', 'Basis', 'Source text', 'Reviewer note', 'Reviewed at (UTC)']
  const rows = review.metrics.map(metric => {
    const decision = decisions[metric.id]
    const amount = decision.source?.value ?? ''
    const row = [metric.name, metric.period, amount, metric.unit, decision.status, review.filename,
      String(decision.source?.page ?? ''), decision.source?.basis ?? '', decision.source?.quote ?? '',
      decision.note, decision.timestamp]
    return row.map((value, index) => index === 2 && /^-?\d+(\.\d+)?$/.test(value) ? value : escapeCsv(value))
  })
  const csv = [header.map(escapeCsv), ...rows].map(row => row.join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'folio-evidence-review.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
