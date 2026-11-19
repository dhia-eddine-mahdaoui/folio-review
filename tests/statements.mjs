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
