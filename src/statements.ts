import type {Line} from './register'

const statementPattern=/^(?:(?:condensed|consolidated|interim|unaudited)\s+)*(?:statements? of (?:operations|income|earnings|cash flows?)|balance sheets?)\b/i
const scales:Record<string,number>={thousand:1000,million:1000000,billion:1000000000,one:1}
const durations:Record<string,number>={three:3,six:6,nine:9,twelve:12}
const months='January February March April May June July August September October November December'.split(' ')
const datePattern=new RegExp('\\b('+months.join('|')+')\\s+(\\d{1,2}),?(?:\\s+((?:19|20)\\d{2}))?','gi')
const numeric=String.raw`(?:\(?-?\d[\d,]*(?:\.\d+)?\)?|[—–])`
const tail=new RegExp('(?:\\s+(?:[$£€]\\s*)?'+numeric+')+\\s*$')
const token=new RegExp(numeric,'g')
const taxonomy:Record<string,{tag:string;label:string}> = {
  operating_income:{tag:'OperatingIncomeLoss',label:'Operating Profit'},
  net_income:{tag:'NetIncomeLoss',label:'Net Income'},
  total_net_sales:{tag:'RevenueFromContractWithCustomerExcludingAssessedTax',label:'Revenues'},
  income_before_provision_for_income_taxes:{tag:'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',label:'Income Before Taxes'},
  provision_for_income_taxes:{tag:'IncomeTaxExpenseBenefit',label:'Income Tax Expense'},
}
const key=(s:string)=>s.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
export const isStatementHeading=(s:string)=>statementPattern.test(s)
type Column={end_date:string;duration_months:number|null;heading:string; box?:Line['box']; grid?:Grid}
type Grid = NonNullable<NonNullable<Line['words']>[number]['grid']>
const gridCell = (line:Line,start:number,end:number) => line.words?.find(word=>word.start<=start && word.end>=end)?.grid
function textBox(line:Line,start:number,end:number) {
  const words = line.words?.filter(word=>word.start<end && word.end>start)
  if (!words?.length) return
  const boxes = words.map(word=>{
    const [left,top,right,bottom] = word.box
    const length = Math.max(1,word.end-word.start)
    return [left+(right-left)*Math.max(0,start-word.start)/length,top,
      right-(right-left)*Math.max(0,word.end-end)/length,bottom]
  })
  return [Math.min(...boxes.map(box=>box[0])),Math.min(...boxes.map(box=>box[1])),
    Math.max(...boxes.map(box=>box[2])),Math.max(...boxes.map(box=>box[3]))] as Line['box']
}
const center = (box:Line['box']) => (box[0]+box[2])/2
function alignedColumn(box:Line['box']|undefined,columns:Column[],index:number,complete:boolean,grid?:Grid) {
  if (grid && columns.some(column=>column.grid?.id===grid.id)) {
    const matched = columns.filter(column=>column.grid?.id===grid.id && column.grid.column===grid.column && column.grid.span===1)
    return grid.span===1 && matched.length===1 ? matched[0] : undefined
  }
  if (!box || columns.some(column=>!column.box)) return complete ? columns[index] : undefined
  const x = center(box)
  let match:Column|undefined
  let distance = Infinity
  for (const column of columns) {
    const current = Math.abs(x-center(column.box!))
    if (current<distance) {distance=current;match=column}
  }
  if (!match) return
  const spacing = Math.min(...columns.filter(column=>column!==match).map(column=>Math.abs(center(column.box!)-center(match!.box!))))
  const tolerance = Math.min(spacing*.49,Math.max(.035,(match.box![2]-match.box![0])*.8))
  return distance<=tolerance ? match : undefined
}
function columns(lines:Line[],instant:boolean):Column[]{
  const header = lines.map(line=>line.text)
  const text=header.join(' ')
  const matches=lines.flatMap(line=>[...line.text.matchAll(datePattern)].map(date=>({date,box:textBox(line,date.index,date.index+date[0].length),grid:gridCell(line,date.index,date.index+date[0].length)})))
  const dates=matches.map(({date})=>date)
  const years=header.find(l=>/^(?:(?:19|20)\d{2}(?:\s+|$))+$/.test(l.trim()))?.trim().split(/\s+/)
  const spans=[...text.matchAll(/\b(three|six|nine|twelve|3|6|9|12)\s+months?\s+ended\b/gi)]
  if (!dates.length && years && instant) {
    const yearLine = lines.find(line=>line.text.trim().split(/\s+/).join(' ')===years.join(' '))!
    return [...yearLine.text.matchAll(/(?:19|20)\d{2}/g)].map(year=>({
      box:textBox(yearLine,year.index,year.index+4),end_date:'',duration_months:null,heading:year[0],
    }))
  }
  return dates.map(([_,month,day,year],i)=>{
    const y=year??(years?.length===dates.length?years[i]:undefined)
    const monthIndex=months.findIndex(m=>m.toLowerCase()===month.toLowerCase())+1
    const end=y?y+'-'+String(monthIndex).padStart(2,'0')+'-'+day.padStart(2,'0'):''
    // Repeated dates identify the boundary between duration groups.
    const width=dates.length/spans.length
    const aligned=spans.length===1||(Number.isInteger(width)&&dates.every((d,j)=>d[1]===dates[j%width][1]&&d[2]===dates[j%width][2]&&(d[3]??years?.[j])===(dates[j%width][3]??years?.[j%width])))
    const span=aligned?spans[Math.floor(i/width)]:undefined
    const duration=span?(durations[span[1].toLowerCase()]??Number(span[1])):null
    return {box:matches[i].box,grid:matches[i].grid,end_date:end,duration_months:instant?null:duration,heading:end&&(instant||duration)?(instant?'As of':span![0])+' '+month+' '+day+', '+y:''}
  })
}
function absoluteAmount(amount:string,scale:string){
  if(!scale)return null
  const [integer,decimal='']=amount.replace(/^-/,'').split('.')
  const digits=integer+decimal.padEnd(String(scales[scale]).length-1,'0')
  const split=integer.length+String(scales[scale]).length-1
  const whole=digits.slice(0,split).replace(/^0+(?=\d)/,'')
  const fraction=digits.slice(split).replace(/0+$/,'')
  return (amount.startsWith('-')?'-':'')+whole+(fraction?'.'+fraction:'')
}
export function extractStatement(lines:Line[]){
  lines = lines.map(line=>line.layoutText ? {...line,rawText:line.text,text:line.layoutText} : line)
  const start=lines.findIndex(l=>isStatementHeading(l.text))
  if(start<0)return []
  const heading=lines[start].text
  const instant=/balance sheet/i.test(heading)
  const first=lines.findIndex((l,i)=>i>start&&/\p{L}/u.test(l.text.replace(datePattern,''))&&tail.test(l.text)&&!/^\(?in\s/i.test(l.text))
  datePattern.lastIndex=0
  const headerRows=lines.slice(start+1,first<0?undefined:first)
  const header=headerRows.map(l=>l.text)
  const note=header.find(t=>/\bin (?:[A-Z]{3} )?(?:thousands|millions|billions)\b/i.test(t))??''
  const defaultScale=note.match(/\bin (?:[A-Z]{3} )?(thousand|million|billion)s/i)?.[1].toLowerCase()??''
  const cols=columns(headerRows,instant)
  const context=lines.slice(0,start+1).map(l=>l.text)
  const currencyCode=header.join(' ').match(/\b(USD|CAD|AUD|NZD|EUR|GBP)\b/i)?.[0].toUpperCase()
  const symbol=lines.map(l=>l.text.match(/[$£€]/)?.[0]).find(Boolean)
  const appleUSD=symbol==='$'&&context.some(s=>/^apple inc\.?$/i.test(s.trim()))
  const currency=currencyCode??(appleUSD?'USD':symbol==='£'?'GBP':symbol==='€'?'EUR':'')
  const result=[]
  let section=header.filter(t=>/:$/.test(t)).at(-1)?.replace(/:$/,'')??''
  for(let i=first;i>=0&&i<lines.length;i++){
    const line=lines[i]
    if(/:\s*$/.test(line.text)){section=line.text.replace(/^\(\d+\)\s*/,'').replace(/:$/,'');continue}
    const suffix=line.text.match(tail)
    if(!suffix||!suffix.index)continue
    let label=line.text.slice(0,suffix.index).trim()
    const cells=[...suffix[0].matchAll(token)]
    // A parenthetical footnote between a label and all financial columns.
    if(cells.length===cols.length+1&&/^\(\d\)$/.test(cells[0][0]))cells.shift()
    if(!/[a-z]/i.test(label))continue
    let rowText=line.rawText ?? line.text
    if(/^authorized;/i.test(label)&&i>0){label=lines[i-1].text+' '+label;rowText=lines[i-1].text+' '+line.text}
    const shares=/shares used in computing/i.test(section)&&/^(basic|diluted)$/i.test(label)
    const perShare=/earnings per share/i.test(section)&&!shares&&/^(basic|diluted)$/i.test(label)
    const shareScale=note.match(/shares[^,]*,?\s*(?:which are reflected )?in (thousand|million|billion)s/i)?.[1].toLowerCase()
    const scale=perShare?'one':shares?(shareScale??defaultScale):defaultScale
    const slots = cells.map((cell,index)=>{
      const start = suffix.index!+cell.index!
      const box = textBox(line,start,start+cell[0].length)
      return {box,column:alignedColumn(box,cols,index,cols.length===cells.length,gridCell(line,start,start+cell[0].length))}
    })
    for(const [index,cell] of cells.entries()){
      const {box,column} = slots[index]
      const col = column && slots.filter(slot=>slot.column===column).length===1 ? column : undefined
      const period=col?.heading??''
      const amount=cell[0].replaceAll(',','').replace(/^\((.+)\)$/,'-$1').replace(/^[–—]$/,'0')
      const flags=[...(!period?['missing_period']:[]),...(!scale?['missing_scale']:[]),...(!currency&&!shares?['missing_currency']:[]),...(!col?['column_alignment_unresolved']:[])]
      const metric=shares?'shares_'+key(label):perShare?'earnings_per_share_'+key(label):key(label)
      const tag = currency==='USD' ? taxonomy[metric] : undefined
      result.push({label,source_label:label,canonical_metric:tag ? tag.label+' (US-GAAP)' : label,
        xbrl_tag:tag ? 'us-gaap:'+tag.tag : null,metric,section,amount,currency:shares?null:currency||null,
        currency_basis:shares?null:currencyCode?'statement currency code':appleUSD?'Apple Inc. reporting currency inferred from issuer and $':symbol??null,
        scale:scale||null,unit:[shares?'shares':currency||symbol,perShare?'per share':scale].filter(Boolean).join(' '),
        normalized_amount:absoluteAmount(amount,scale),
        period,end_date:col?.end_date||null,duration_months:col?.duration_months??null,column:index+1,review_flags:flags,
        source:{page:line.page,column:index+1,text:[label,cell[0],period].filter(Boolean).join(" · "),rawText:rowText,box:box??(cells.length===1?line.box:[0,0,0,0] as Line["box"]),extraction_run_id:line.extraction_run_id,confidence:line.confidence,ocr:line.ocr,cell_box:box??null,statement_heading:heading,scale_note:note,column_heading:period,header_lines:period?[period]:[],row_label:label}})
    }
  }
  return result
}
type Observation=ReturnType<typeof extractStatement>[number]
export function validateStatements(fields:Observation[]){
  const checks:{name:string;period:string;page:number;unit:string;reported:number;calculated:number;difference:number;status:string;total:Observation;operands:{finding:Observation;sign:number}[]}[] = []
  const groups=new Map<string,Observation[]>()
  for(const f of fields){const id=f.source.page+'|'+f.period;const group=groups.get(id)??[];group.push(f);groups.set(id,group)}
  for(const rows of groups.values()){
    if(!rows[0].period)continue
    const get=(metric:string,section?:string)=>{
      const matches=rows.filter(r=>r.metric===metric&&(!section||r.section.toLowerCase()===section))
      return matches.length===1?matches[0]:undefined
    }
    function check(name:string,total:Observation|undefined,terms:[Observation|undefined,number][]){
      if(!total||terms.some(([t])=>!t||t.review_flags.length||t.unit!==total.unit)||total.review_flags.length)return
      const expected=terms.reduce((v,[t,sign])=>v+Number(t!.amount)*sign,0)
      const difference=Number((Number(total.amount)-expected).toFixed(8))
      if(!Number.isFinite(difference))return
      checks.push({name,period:total.period,page:total.source.page,unit:total.unit,reported:Number(total.amount),calculated:expected,difference,status:difference===0?'passed':'failed',
        total,operands:terms.map(([finding,sign])=>({finding:finding!,sign}))})
    }
    const sales=get('total_net_sales')
    check('Revenue components',sales,[[get('products','net sales'),1],[get('services','net sales'),1]])
    for(const [name,section,parts] of [
      ['Revenue by geography','net sales by reportable segment',['americas','europe','greater_china','japan','rest_of_asia_pacific']],
      ['Revenue by product category','net sales by category',['iphone','mac','ipad','wearables_home_and_accessories','services']]
    ] as const)check(name,get('total_net_sales',section),parts.map(p=>[get(p,section),1]))
    check('Cost of sales',get('total_cost_of_sales'),[[get('products','cost of sales'),1],[get('services','cost of sales'),1]])
    check('Operating expenses',get('total_operating_expenses'),[[get('research_and_development'),1],[get('selling_general_and_administrative'),1]])
    check('Pretax income',get('income_before_provision_for_income_taxes'),[[get('operating_income'),1],[get('other_income_expense_net'),1]])
    check('Gross profit',get('gross_margin'),[[sales,1],[get('total_cost_of_sales'),-1]])
    check('Operating income',get('operating_income'),[[get('gross_margin'),1],[get('total_operating_expenses'),-1]])
    check('Net income',get('net_income'),[[get('income_before_provision_for_income_taxes'),1],[get('provision_for_income_taxes'),-1]])
    check('Balance sheet equation',get('total_assets'),[[get('total_liabilities'),1],[get('total_shareholders_equity')??get('total_stockholders_equity')??get('total_equity'),1]])
    for(const section of new Set(rows.map(row=>row.section.toLowerCase()).filter(Boolean))){
      const sectionRows=rows.filter(row=>row.section.toLowerCase()===section)
      const total=get('total_'+key(section),section)
      if(total&&sectionRows.at(-1)===total&&sectionRows.length>=3&&sectionRows.slice(0,-1).every(row=>!/^(?:total|subtotal)_/.test(row.metric))&&
        !checks.some(check=>check.total===total)) check(total.label,total,sectionRows.slice(0,-1).map(row=>[row,1]))
    }
    const cash=(word:string)=>rows.find(r=>r.metric.endsWith(word))
    check('Cash rollforward',cash('ending_balances'),[[cash('beginning_balances'),1],[cash('by_operating_activities'),1],[cash('by_investing_activities'),1],[cash('in_financing_activities'),1]])
  }
  return checks
}
