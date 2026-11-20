import {normalizedAmount, sourceScale, scaleName} from './amount.ts'
import {findingKey, findingStatus, reviewedFinding} from './review.ts'
import type {Finding} from './findings'
import type {Figure} from './register'

export type TieOutSide = {finding:Finding; amount:string; unit:string; page:number}
export type TieOut = {id:string; metric:string; period:string; a:TieOutSide; b:TieOutSide; failed:boolean; difference:string; unit:string}

const scales:Record<string,number> = {thousand:3, million:6, billion:9, trillion:12}

// Fiscal-year periods are compared by year: "FY2025" ties to "Twelve Months Ended December 31, 2025".
export function periodKey(finding:Finding & {end_date?:string|null; duration_months?:number|null}) {
  if (finding.duration_months===12 && finding.end_date) return 'FY'+finding.end_date.slice(0,4)
  const period = finding.period.trim()
  const fiscal = period.match(/^FY\s*((?:19|20)\d{2})$/i) ?? period.match(/^(?:twelve months|(?:fiscal |financial )?year) ended\b.*?\b((?:19|20)\d{2})\b/i)
  return fiscal ? 'FY'+fiscal[1] : period.toLowerCase().replace(/\s+/g,' ')
}

function decimal(value:string, precision:number) {
  const [whole,fraction=''] = value.replace(/^-/,'').split('.')
  return BigInt((value.startsWith('-') ? '-' : '')+whole+fraction.padEnd(precision,'0').slice(0,precision))
}

// Difference expressed in the first side's source scale, e.g. "0.2" USD million.
function variance(a:TieOutSide, b:TieOutSide) {
  const left = normalizedAmount(a.amount,a.unit)!, right = normalizedAmount(b.amount,b.unit)!
  const precision = Math.max(left.value.split('.')[1]?.length ?? 0,right.value.split('.')[1]?.length ?? 0)
  const raw = decimal(left.value,precision)-decimal(right.value,precision)
  const shift = precision+(scales[scaleName(a.unit) ?? ''] ?? 0)
  const negative = raw<0n
  const digits = (negative ? -raw : raw).toString().padStart(shift+1,'0')
  const text = shift ? (digits.slice(0,-shift)+'.'+digits.slice(-shift)).replace(/\.?0+$/,'') : digits
  return {failed:raw!==0n,difference:(negative ? '-' : '')+text}
}

export function tieOuts(findings:Finding[], figures:Figure[], exclusions?:Parameters<typeof findingStatus>[2]):TieOut[] {
  const groups = new Map<string,TieOutSide[]>()
  for (const finding of findings) {
    if (findingStatus(finding,figures,exclusions)==='Excluded') continue
    const reviewed = reviewedFinding(finding,figures)
    const observed = reviewed ? sourceScale(reviewed) : finding
    const metric = reviewed?.label ?? finding.canonical_metric ?? finding.label
    const normalized = normalizedAmount(observed.amount,observed.unit)
    if (!normalized?.unit || !finding.period || finding.source.box[2]<=finding.source.box[0]) continue
    const key = [metric.toLowerCase(),periodKey(finding),normalized.unit].join('|')
    const group = groups.get(key) ?? []
    group.push({finding,amount:observed.amount,unit:observed.unit,page:finding.source.page})
    groups.set(key,group)
  }
  const result:TieOut[] = []
  for (const group of groups.values()) {
    for (let i=0;i<group.length;i++) for (let j=i+1;j<group.length;j++) {
      const [a,b] = [group[i],group[j]].sort((x,y)=>x.page-y.page)
      // A tie-out links the same figure reported in different places: other pages or other statements.
      if (a.page===b.page && (a.finding.source as {statement_heading?:string}).statement_heading===(b.finding.source as {statement_heading?:string}).statement_heading) continue
      result.push({id:findingKey(a.finding)+'↔'+findingKey(b.finding),metric:a.finding.canonical_metric ?? a.finding.label,
        period:periodKey(a.finding),a,b,unit:a.unit,...variance(a,b)})
    }
  }
  return result.sort((x,y)=>Number(y.failed)-Number(x.failed) || x.a.page-y.a.page)
}

export const involves = (tie:TieOut, finding:Finding) => [tie.a,tie.b].some(side=>findingKey(side.finding)===findingKey(finding))
