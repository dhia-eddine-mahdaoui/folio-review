import assert from 'node:assert/strict'
import {service} from '../server/service.js'
const rows=['Example Company','Statements of Operations','(In USD millions)','Three Months Ended Six Months Ended','March 29, March 30, March 29, March 30,','2025 2024 2025 2024','Income before provision for income taxes 30 29 75 71','Provision for income taxes 5 6 14 13','Net income $ 25 $ 23 $ 61 $ 58']
async function analyze(lines){
  const req=new Request('http://localhost/api/v2/analyze',{method:'POST',body:JSON.stringify({pages:[lines.join('\n')]})})
  return (await service(req)).json()
}
const good=await analyze(rows)
assert.equal(good.extraction_status,'extracted')
assert.deepEqual(good.findings.filter(f=>f.metric==='net_income').map(f=>[f.end_date,f.duration_months,f.normalized_amount]),[
  ['2025-03-29',3,'25000000'],['2024-03-30',3,'23000000'],['2025-03-29',6,'61000000'],['2024-03-30',6,'58000000']])
assert.equal(good.arithmetic_checks.length,4)
assert(good.arithmetic_checks.every(c=>c.status==='passed'))
const wrong=await analyze([...rows.slice(0,-1),'Net income 24 23 61 58'])
assert(wrong.review_flags.includes('arithmetic_mismatch'))
const short=await analyze([...rows.slice(0,-1),'Net income 25 61 58'])
assert(short.findings.filter(f=>f.metric==='net_income').every(f=>!f.period&&f.review_flags.includes('column_alignment_unresolved')))
const unresolved=await analyze([rows[1],rows.at(-1)])
assert.equal(unresolved.extraction_status,'partial')
for(const flag of ['missing_currency','missing_scale','missing_period'])assert(unresolved.review_flags.includes(flag))
console.log('Statement regression checks passed.')
for (const finding of good.findings.filter(f=>f.metric==='net_income')) {
  assert.equal(finding.source.row_label,'Net income')
  assert.equal(finding.canonical_metric,'Net Income (US-GAAP)')
  assert.equal(finding.source.text,`Net income · ${finding.amount} · ${finding.period}`)
  assert.deepEqual(finding.source.header_lines,[finding.period])
}

const row = (text, parts, top) => {
  let offset = 0
  return {page:1,text,box:[0,top,1,top+.02],words:parts.map(([word,left,right])=>{
    const start = text.indexOf(word,offset)
    offset = start+word.length
    return {text:word,start,end:offset,box:[left,top,right,top+.02]}
  })}
}
const {extractStatement} = await import('../src/statements.ts')
const {applyLayout} = await import('../src/layout.ts')
const located = [
  row('Statements of Operations',[],.1),
  row('(In USD millions)',[],.15),
  row('Twelve Months Ended',[],.2),
  row('December 31, 2025 December 31, 2024',[['December 31, 2025',.63,.77],['December 31, 2024',.80,.94]],.23),
  row('Net income 14.4',[['Net income',.1,.3],['14.4',.855,.885]],.26),
]
const sparseTable = extractStatement(located)
assert.equal(sparseTable[0].end_date,'2024-12-31')
assert.match(sparseTable[0].source.text,/14\.4 · .*2024/)
const table = {page:1,cells:[
  {row:0,column:1,span:1,text:'December 31, 2025',box:[.63,.23,.77,.25]},
  {row:0,column:2,span:1,text:'December 31, 2024',box:[.80,.23,.94,.25]},
  {row:1,column:0,span:1,text:'Net income',box:[.10,.26,.30,.28]},
  {row:1,column:2,span:1,text:'14.4',box:[.63,.26,.66,.28]},
]}
const docling = extractStatement(applyLayout(located,[table]))
assert.equal(docling[0].end_date,'2024-12-31')
assert.deepEqual(docling[0].source.cell_box,[.63,.26,.66,.28])
