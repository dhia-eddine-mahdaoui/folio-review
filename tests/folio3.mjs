import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {read} from '../server/read-local.js'
import {service} from '../server/service.js'
import {analyzeLines} from '../src/findings.ts'
import {periodKey, tieOuts} from '../src/tieout.ts'
import {canonical, narrativeConcept} from '../src/taxonomy.ts'
import {vlmLines} from '../src/vlm.ts'
import {b64, verifySignOff} from '../src/passkey.ts'

const findingsOf = async path => analyzeLines((await read(new Uint8Array(await readFile(new URL(path,import.meta.url))))).flatMap(page=>page.lines)).items

// Uniform taxonomy across narrative pages and statements
const sample = await findingsOf('../public/northfield-sample.pdf')
assert.equal(sample.find(f=>f.label==='Revenue').canonical_metric,'Revenues (US-GAAP)')
assert.equal(sample.find(f=>f.source_label==='Operating income').canonical_metric,'Operating Profit (US-GAAP)')
assert.equal(sample.find(f=>f.source_label==='Net income').canonical_metric,'Net Income (US-GAAP)')
assert.equal(canonical(narrativeConcept('Revenue'),'GBP million','Revenue').label,'Revenue (IFRS)')
assert.equal(canonical(narrativeConcept('Free cash flow'),'USD million','Free cash flow').label,'Free Cash Flow (Non-GAAP)')
assert.equal(canonical(narrativeConcept('Revenue'),'','Revenue').label,'Revenue','no stated currency means no framework')

// Cross-page tie-outs compare the same metric and fiscal period only
assert.equal(periodKey({period:'FY2025'}),'FY2025')
assert.equal(periodKey({period:'Twelve Months Ended December 31, 2025',end_date:'2025-12-31',duration_months:12}),'FY2025')
assert.deepEqual(tieOuts(sample,[]),[],'operating income and pre-tax income are different metrics and must not tie out')
const fixture = await findingsOf('./fixtures/northfield-tieout.pdf')
const [tie] = tieOuts(fixture,[])
assert.equal(tie.metric,'Net Income (US-GAAP)')
assert.deepEqual([tie.a.page,tie.a.amount,tie.b.page,tie.b.amount,tie.failed,tie.difference,tie.unit],[1,'15.6',2,'15.8',true,'-0.2','USD million'])
const verified = {...tie.a.finding,id:'fix',label:'Net Income (US-GAAP)',amount:'15.8',note:'',saved:'2026-11-20T00:00:00Z',
  original:tie.a.finding,findingKey:JSON.stringify([1,tie.a.finding.source.text,null,'Net profit','15.6','FY2025','USD million'])}
assert.equal(tieOuts(fixture,[verified]).find(item=>item.metric==='Net Income (US-GAAP)').failed,false,'a reviewer correction resolves the variance')

// In-browser VLM output parsing (Florence-2 OCR_WITH_REGION quads)
assert.deepEqual(vlmLines({quad_boxes:[[10,20,110,20,110,40,10,40],[0,0,0,0,0,0,0,0]],labels:['</s>Net income 15.8','empty']},200,100),
  [{text:'Net income 15.8',box:[.05,.2,.55,.4]}])

// WebAuthn ES256 sign-off verification
const keys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
const root = 'ab'.repeat(32)
const origin = 'http://127.0.0.1:8031'
const authenticator = new Uint8Array(37); authenticator[32] = 0x05
const client = new TextEncoder().encode(JSON.stringify({type:'webauthn.get',challenge:b64(Uint8Array.from(root.match(/../g),h=>parseInt(h,16))),origin}))
const signed = new Uint8Array([...authenticator,...new Uint8Array(await crypto.subtle.digest('SHA-256',client))])
const raw = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,signed))
const integer = bytes => {let value=[...bytes]; while (value.length>1 && value[0]===0 && value[1]<0x80) value.shift(); if (value[0]>=0x80) value.unshift(0); return [0x02,value.length,...value]}
const der = (([r,s])=>new Uint8Array([0x30,r.length+s.length,...r,...s]))([integer(raw.slice(0,32)),integer(raw.slice(32))])
const signoff = {credential_id:'id',public_key:b64(await crypto.subtle.exportKey('spki',keys.publicKey)),algorithm:'ES256',signed_root:root,events:1,
  authenticator_data:b64(authenticator),client_data_json:b64(client),signature:b64(der)}
assert.equal(await verifySignOff(signoff,origin),true)
assert.equal(await verifySignOff({...signoff,signed_root:'cd'.repeat(32)},origin),false,'signature is bound to the chain root')
assert.equal(await verifySignOff(signoff,'https://evil.invalid'),false,'signature is bound to the origin')

// MCP 2026-07-28: tasks, input_required (multi round-trip) and the MCP Apps card
const calls = []
const bridge = {
  allowed:()=>true,
  async call(operation,args){
    calls.push([operation,args])
    if (operation==='run_workpaper_tieout') {await new Promise(resolve=>setTimeout(resolve,30)); return {variances:1,tie_outs:[{metric:'Net Income (US-GAAP)',status:'variance'}]}}
    if (operation==='propose_finding_edit') return args.context?.unit && args.context?.period ? {draft_id:'d1',status:'Draft'} :
      {input_required:{fields:['unit','period'],message:'Confirm the unit and period',suggestions:{}}}
    throw Error('unexpected')
  },
}
const url = 'http://127.0.0.1:8031/mcp'
let id = 0
const mcp = async (method,params={}) => {
  const name = params.name ?? params.uri
  const response = await service(new Request(url,{method:'POST',headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,...(name ? {'Mcp-Name':name} : {})},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}),read,bridge)
  return (await response.json())
}
const discovered = (await mcp('server/discover')).result
assert.deepEqual(Object.keys(discovered.capabilities.extensions).sort(),['io.modelcontextprotocol/tasks','io.modelcontextprotocol/ui'])
const listed = (await mcp('tools/list')).result.tools
assert.equal(listed.find(tool=>tool.name==='run_workpaper_tieout').execution.taskSupport,'optional')
assert.equal(listed.find(tool=>tool.name==='propose_finding_edit')._meta.ui.resourceUri,'ui://folio/verification-card')
const started = Date.now()
const created = (await mcp('tools/call',{name:'run_workpaper_tieout',arguments:{},task:{ttl:60000}})).result.task
assert.equal(created.status,'working')
assert(Date.now()-started<30,'task handle returns before the tie-out finishes')
let task = created
while (task.status==='working') {await new Promise(resolve=>setTimeout(resolve,10)); task = (await mcp('tasks/get',{taskId:created.taskId})).result}
assert.equal(task.status,'completed')
const outcome = (await mcp('tasks/result',{taskId:created.taskId})).result
assert.equal(outcome.structuredContent.variances,1)
assert.equal(outcome._meta['io.modelcontextprotocol/related-task'].taskId,created.taskId)
assert.equal((await mcp('tasks/get',{taskId:'missing'})).error.code,-32602)
const edit = {workpaper_id:'w',finding_id:'f1',changes:{amount:'128.4'},rationale:'Confirm'}
const pendingInput = (await mcp('tools/call',{name:'propose_finding_edit',arguments:edit})).result
assert.equal(pendingInput.resultType,'input_required')
assert.deepEqual(pendingInput.inputRequests.confirm_context.params.requestedSchema.required,['unit','period'])
const forged = (await mcp('tools/call',{name:'propose_finding_edit',arguments:{...edit,finding_id:'f2'},requestState:pendingInput.requestState,
  inputResponses:{confirm_context:{action:'accept',content:{unit:'USD million',period:'FY2025'}}}})).result
assert.equal(forged.isError,true,'request state is bound to the finding')
const answered = (await mcp('tools/call',{name:'propose_finding_edit',arguments:edit,requestState:pendingInput.requestState,
  inputResponses:{confirm_context:{action:'accept',content:{unit:'USD million',period:'FY2025'}}}})).result
assert.equal(answered.structuredContent.status,'Draft')
assert.deepEqual(calls.at(-1)[1].context,{unit:'USD million',period:'FY2025'})
const card = (await mcp('resources/read',{uri:'ui://folio/verification-card'})).result.contents[0]
assert.equal(card.mimeType,'text/html;profile=mcp-app')
assert.match(card.text,/review_finding_draft/)
console.log('Folio 3.0 taxonomy, tie-out, VLM, passkey and MCP extension checks passed.')
