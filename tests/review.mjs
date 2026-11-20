import assert from 'node:assert/strict'
import {findingKey,findingStatus,queueCounts,workpaperFindings} from '../src/review.ts'
import {normalizedAmount,formattedAmount,sourceScale} from '../src/amount.ts'
import {appendHistory,verifyHistory,digestJson} from '../src/audit.ts'

const finding = {label:'Revenue',amount:'128.4',unit:'USD million',period:'FY2025',source:{page:1,text:'Revenue 128.4',box:[0,0,1,1]}}
const key = findingKey(finding)
const figure = {...finding,id:'figure',findingKey:key,original:finding}
let states = {}
assert.equal(findingStatus(finding,[],states),'Pending')
for (const [status,expected] of [['On hold','On Hold'],['Escalated','Escalated'],['Excluded','Excluded']]) {
  states = {[key]:{finding,status,reason:'Review',saved:''}}
  const counts = queueCounts([finding],[],states)
  assert.equal(counts[expected],1)
  assert.equal(Object.values(counts).reduce((sum,n)=>sum+n),1)
}
assert.equal(queueCounts([finding],[figure],states).Verified,1)
assert.equal(queueCounts(workpaperFindings([],[{...figure,original:undefined}]),[figure]).Verified,1)
assert.deepEqual(normalizedAmount('128.4','USD million'),{value:'128400000',unit:'USD'})
assert.equal(formattedAmount('-128.42345678','USD million'),'-128,423,456.78 USD')
assert.equal(formattedAmount('5','kobo'),'0.05 NGN')
assert.equal(sourceScale({...figure,amount:'128400000',unit:'USD'}).amount,'128.4')
assert.equal(await digestJson({a:1,b:2}),await digestJson({b:2,a:1}))
const event = {id:'a',action:'Verify figure',reviewer:'Reviewer',reason:'',saved:'2026-11-20T10:00:00Z'}
const pdf = 'f'.repeat(64)
const history = await appendHistory([event,{...event,id:'b'}],pdf)
assert.equal(await verifyHistory(history,pdf),true)
assert.equal(await verifyHistory(history,'e'.repeat(64)),false)
assert.equal(await verifyHistory([{...history[0],reviewer:'Changed'},history[1]],pdf),false)
await assert.rejects(appendHistory(history.slice(1),pdf,history),/append-only/)
console.log('Review and audit checks passed.')
