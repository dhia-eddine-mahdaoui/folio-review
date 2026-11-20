import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'

// MCP 2026-07-28 extensions served by the local co-pilot hub:
// io.modelcontextprotocol/tasks (polling task handles), multi round-trip input_required results, and io.modelcontextprotocol/ui cards.
export const tasksExtension='io.modelcontextprotocol/tasks'
export const uiExtension='io.modelcontextprotocol/ui'
export const cardUri='ui://folio/verification-card'
export const appMime='text/html;profile=mcp-app'

const secret=randomBytes(32)
const sign=payload=>createHmac('sha256',secret).update(payload).digest('base64url')

export function requestState(value){
  const payload=Buffer.from(JSON.stringify(value)).toString('base64url')
  return payload+'.'+sign(payload)
}

export function readRequestState(state){
  if(typeof state!=='string'||!state.includes('.'))return
  const [payload,mac]=state.split('.')
  const expected=Buffer.from(sign(payload)),actual=Buffer.from(mac??'')
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return
  try{return JSON.parse(Buffer.from(payload,'base64url').toString())}catch{return}
}

// Confirmation of scale and period before an agent may stage a draft on an ambiguous finding.
export function inputRequired(prompt,state){
  const properties={}
  for(const field of prompt.fields){
    properties[field]=field==='unit'
      ?{type:'string',title:'Unit and scale',description:'Currency and scale as printed, e.g. USD million',maxLength:120,...(prompt.suggestions?.unit?{default:prompt.suggestions.unit}:{})}
      :{type:'string',title:'Reporting period',description:'Fiscal period, e.g. FY2025',maxLength:120,...(prompt.suggestions?.period?{default:prompt.suggestions.period}:{})}
  }
  return {resultType:'input_required',requestState:requestState(state),inputRequests:{confirm_context:{method:'elicitation/create',params:{
    mode:'form',message:prompt.message,requestedSchema:{type:'object',properties,required:prompt.fields},
  }}}}
}

export function elicitedContext(params,tool){
  const response=params?.inputResponses?.confirm_context
  if(!response)return {}
  const state=readRequestState(params.requestState)
  if(!state||state.tool!==tool||state.finding_id!==params.arguments?.finding_id)throw Error('The input_required request state is invalid or expired.')
  if(response.action!=='accept')throw Error('The reviewer declined to confirm the unit and period.')
  const content=response.content
  if(!content||typeof content!=='object'||Object.values(content).some(value=>typeof value!=='string'||!value.trim()||value.length>120))throw Error('Confirmed unit and period must be non-empty text.')
  return {context:content}
}

const tasks=new Map()
const ttlLimit=60*60*1000

function snapshot(task){
  const {result,error,controller,...visible}=task
  return visible
}

export function createTask(run,ttl){
  const now=new Date().toISOString()
  const task={taskId:randomUUID(),status:'working',statusMessage:'Reconciling workpaper',createdAt:now,lastUpdatedAt:now,
    ttl:Math.min(Number.isSafeInteger(ttl)&&ttl>0?ttl:10*60*1000,ttlLimit),pollInterval:500}
  tasks.set(task.taskId,task)
  setTimeout(()=>tasks.delete(task.taskId),task.ttl).unref?.()
  Promise.resolve().then(run).then(result=>{
    if(task.status==='cancelled')return
    Object.assign(task,{status:'completed',statusMessage:'Tie-out complete',result,lastUpdatedAt:new Date().toISOString()})
  },cause=>{
    if(task.status==='cancelled')return
    Object.assign(task,{status:'failed',statusMessage:cause.message,error:cause.message,lastUpdatedAt:new Date().toISOString()})
  })
  return snapshot(task)
}

export function taskMethod(method,params){
  if(method==='tasks/list')return {tasks:[...tasks.values()].map(snapshot)}
  const task=tasks.get(params?.taskId)
  if(!task)return {error:'Unknown or expired task.'}
  if(method==='tasks/get')return snapshot(task)
  if(method==='tasks/cancel'){
    if(['working','input_required'].includes(task.status))Object.assign(task,{status:'cancelled',statusMessage:'Cancelled by client',lastUpdatedAt:new Date().toISOString()})
    return snapshot(task)
  }
  if(method==='tasks/result'){
    if(task.status==='completed')return {result:task.result,task:snapshot(task)}
    if(task.status==='failed')return {result:{isError:true,content:[{type:'text',text:task.error}]},task:snapshot(task)}
    return {error:task.status==='cancelled'?'The task was cancelled.':'The task has not finished. Poll tasks/get until it completes.'}
  }
}

export function verificationCard(){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
:root{color-scheme:light;--ink:#202124;--ink2:#5f6368;--rule:#dadce0;--paper:#ffffff;--mark:#d93025}
body{margin:0;font:13px/1.4 system-ui,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper)}
main{padding:12px;display:grid;gap:8px}h1{font:600 15px system-ui,sans-serif;margin:0}small,p{color:var(--ink2);margin:0}
img{max-width:100%;border:1px solid var(--rule);background:#fff}dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
dt{color:var(--ink2)}dd{margin:0;font-family:ui-monospace,monospace}s{color:#8b8679}
.actions{display:flex;gap:6px}button{font:inherit;padding:6px 12px;border:1px solid var(--rule);border-radius:4px;background:var(--paper);color:var(--ink);cursor:pointer}
button.primary{background:#1a73e8;border-color:#1a73e8;color:#fff}[role=status]{min-height:1.2em}.error{color:var(--mark)}
</style></head><body><main aria-live="polite"><h1>Folio evidence</h1><p>Waiting for the tool result…</p></main>
<script>
let sequence=0,draft
const pending=new Map()
const main=document.querySelector('main')
const send=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*')})
const text=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
function render(data){
  draft=data
  const rows=Object.entries(data.changes||{}).map(([k,v])=>'<dt>'+text(k)+'</dt><dd><s>'+text(data.before?.[k]??'—')+'</s> → '+text(v)+'</dd>').join('')
  main.innerHTML='<h1>'+text(data.finding?.label)+' · p. '+text(data.evidence?.page)+'</h1>'+
    (data.evidence?.image?'<img alt="Cited PDF evidence" src="'+text(data.evidence.image)+'">':'')+
    '<small>'+text(data.finding?.source)+'</small><dl>'+rows+'</dl><p>'+text(data.rationale)+'</p>'+
    '<div class="actions"><button class="primary" data-decision="approve">Approve &amp; Verify</button><button data-decision="reject">Reject draft</button></div><p role="status"></p>'
}
main.addEventListener('click',async event=>{
  const decision=event.target?.dataset?.decision
  if(!decision||!draft)return
  const status=main.querySelector('[role=status]')
  status.className='';status.textContent='Recording decision…'
  try{
    const result=await send('tools/call',{name:'review_finding_draft',arguments:{draft_id:draft.draft_id,decision}})
    if(result?.isError)throw Error(result.content?.[0]?.text)
    status.textContent=decision==='approve'?'Approved and verified in Folio.':'Draft rejected.'
    main.querySelectorAll('button').forEach(button=>button.disabled=true)
  }catch(error){status.className='error';status.textContent=error.message||'Folio could not record the decision.'}
})
addEventListener('message',({data})=>{
  if(!data||data.jsonrpc!=='2.0')return
  if(data.id&&pending.has(data.id)){const request=pending.get(data.id);pending.delete(data.id);data.error?request.reject(Error(data.error.message)):request.resolve(data.result);return}
  if(data.method==='ui/notifications/tool-result'&&data.params?.structuredContent)render(data.params.structuredContent)
})
send('ui/initialize',{appInfo:{name:'Folio verification card',version:'3.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')).catch(()=>{})
</script></body></html>`
}
