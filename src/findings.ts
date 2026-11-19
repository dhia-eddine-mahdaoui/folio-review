import {extractStatement,isStatementHeading,validateStatements} from './statements.ts'
import type { Line } from './register'

export type Finding = {label:string; amount:string; unit:string; period:string; source:Line}
const fields: [string, RegExp][] = [
  ['Service revenue', /^service revenue/i], ['Revenue', /^(?:total revenue|revenue|net sales)\b/i],
  ['EBITDA margin', /^ebitda margin/i], ['Adjusted EBITDA', /^adjusted ebitda\b/i],
  ['EBITDA', /^(?:ebitda\b|earnings before interest.*?\(ebitda\))/i],
  ['Profit before tax', /^(?:profit before (?:income )?tax|income before tax)/i],
  ['Net profit', /^(?:profit for the (?:year|period)|net (?:profit|income))\b/i],
  ['Earnings per share', /^earnings per share/i], ['Capital expenditure', /^capital expenditure/i],
  ['Operating profit', /^operating (?:profit|income)/i], ['Free cash flow', /^free cash flow/i],
  ['Mobile subscribers', /^mobile subscribers/i], ['Active data users', /^active data users/i],
  ['Active fintech subscribers', /^active fintech subscribers/i],
  ['Subtotal', /^sub[ -]?total\b/i], ['Sales tax', /^(?:sales tax|tax|vat)\b/i],
  ['Total due', /^(?:(?:grand |net )?total(?: due| amount)?|amount due|balance due)\b/i],
  ['Tip', /^(?:tip|gratuity)\b/i], ['Change', /^change(?: due)?\b/i],
]
const money:Record<string,string>={N:'NGN','₦':'NGN','£':'GBP','€':'EUR','$':'$', '₺':'TRY'}
const number=/^(?:(NGN|USD|GBP|EUR|TRY|MYR|RM|N|₦|£|€|\$|₺)\s*)?(-?\d[\d,]*(?:\.\d+)?)(?:\s*(%|trillion|billion|million|thousand|kobo|USD|GBP|EUR|MYR|TRY|NGN))?(?=$|[\s,;.)])/i
function narrative(lines:Line[]):Finding[]{
  const output:Finding[]=[]
  const seen=new Set<string>()
  const year=lines.slice(0,100).map(l=>l.text).join(' ').match(/(?:financial |fiscal )?year ended\s+\d{1,2}\s+\w+\s+(20\d{2})/i)?.[1]
  for(let i=0;i<lines.length;i++){
    let source=lines[i]
    let text=source.text.replace(/^[\s●•*]+/,'')
    const next=lines[i+1]
    if(next?.page===source.page && /^to\s+(?:\D{0,4})\d/i.test(next.text)){
      text+=' '+next.text
      source={...source,text:source.text+' '+next.text,box:[Math.min(source.box[0],next.box[0]),Math.min(source.box[1],next.box[1]),Math.max(source.box[2],next.box[2]),Math.max(source.box[3],next.box[3])]}
    }
    for(const [label,pattern] of fields){
      const prefix=text.match(pattern)
      if(!prefix)continue
      const tail=text.slice(prefix[0].length).trim()
      const target=tail.match(/\bto\s+(?=[\d£€$₦₺-]|(?:N|USD|EUR|GBP|NGN)\s*\d)/i)
      const part=target?tail.slice(target.index!+target[0].length):tail.replace(/^\s*(?:\([^)]*\)\s*)?[:=]?\s*/,'')
      const value=part.match(number)
      if(!value)break
      // Multi-column tables need column and period attribution by a reviewer.
      if(!target && part.slice(value[0].length).trim().match(/^[\d(]/))break
      const currency=value[1]??'',scale=value[3]??''
      const unit=scale.toLowerCase()==='kobo'?scale:[money[currency]??currency,scale].filter(Boolean).join(' ')
      const amount=value[2].replaceAll(',','')
      const identity=[label,amount,unit,source.page].join('|')
      if(!seen.has(identity)){
        output.push({label,amount,unit,period:year?'FY'+year:'',source})
        seen.add(identity)
      }
      break
    }
  }
  return output
}

export function receiptCheck(items:Finding[]){
  const subtotal=items.filter(f=>f.label==='Subtotal'), total=items.filter(f=>f.label==='Total due')
  if(subtotal.length!==1||total.length!==1||subtotal[0].source.page!==total[0].source.page)return
  const additions=items.filter(f=>['Sales tax','Tip'].includes(f.label)&&f.source.page===total[0].source.page)
  if(!additions.length||new Set(additions.map(f=>f.label)).size!==additions.length)return
  const terms=[subtotal[0],...additions,total[0]]
  if(new Set(terms.map(f=>f.unit)).size!==1||terms.some(f=>!/^\d+(?:\.\d{1,2})?$/.test(f.amount)))return
  const cents=(f:Finding)=>Math.round(Number(f.amount)*100)
  const difference=cents(total[0])-terms.slice(0,-1).reduce((sum,f)=>sum+cents(f),0)
  return {matches:difference===0,difference:(difference/100).toFixed(2),unit:total[0].unit,calculation:terms.slice(0,-1).map(f=>f.amount).join(' + ')+' vs '+total[0].amount}
}

export function analyzeLines(lines:Line[]){
  const pages=new Map<number,Line[]>()
  for(const l of lines){const p=pages.get(l.page)??[];p.push(l);pages.set(l.page,p)}
  const tables:ReturnType<typeof extractStatement>=[]
  const rest:Line[]=[]
  const issues=new Set<string>()
  for(const rows of pages.values()){
    if(rows.some(l=>isStatementHeading(l.text))){
      const starts=rows.flatMap((l,i)=>isStatementHeading(l.text)?[i]:[])
      const fields=starts.flatMap((start,i)=>extractStatement(rows.slice(i===0?0:start,starts[i+1])))
      if(!fields.length)issues.add('unresolved_statement')
      tables.push(...fields)
      for(const f of fields)for(const flag of f.review_flags)issues.add(flag)
    }else{rest.push(...rows)}
  }
  const other=narrative(rest).map(f=>({...f,review_flags:[...(!f.period?['missing_period']:[]),...(!f.unit?['missing_unit']:[])]}))
  for(const f of other)for(const flag of f.review_flags)issues.add(flag)
  const checks=validateStatements(tables)
  if(checks.some(c=>c.status==='failed'))issues.add('arithmetic_mismatch')
  const items=[...tables,...other]
  const status=!items.length?'no_findings':issues.size?'partial':'extracted'
  return {items,checks,review_flags:[...issues],extraction_status:status}
}
export function findings(lines:Line[]):Finding[]{return analyzeLines(lines).items}
