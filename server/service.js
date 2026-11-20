import {resources,appResources,workspaceTools} from '../src/bridgeCatalog.ts'
import {appMime,cardUri,createTask,elicitedContext,inputRequired,taskMethod,tasksExtension,uiExtension,verificationCard} from './mcp-extensions.js'
import { analyzeLines,receiptCheck } from '../src/findings.ts'

const byteLimit=8*1024*1024
const selection={metric:{type:'string',description:'Optional canonical metric, e.g. net_income'},page:{type:'integer',minimum:1,description:'Optional source page'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,description:'Maximum findings returned. Use next_offset to continue.'}}
const inputs={
  analyze_text:{description:'Extract proposed financial and receipt fields from page-ordered text. Returns amount, unit, period and source evidence.',inputSchema:{type:'object',properties:{...selection,pages:{type:'array',items:{type:'string'},minItems:1,maxItems:150}},required:['pages']}},
  analyze_pdf:{description:'Extract fields from a base64 PDF (up to 6 MiB). Reports pages requiring OCR.',inputSchema:{type:'object',properties:{...selection,pdf_base64:{type:'string',description:'PDF bytes encoded as base64'}},required:['pdf_base64']}}
}
function textAnalysis(pages){
  if(!Array.isArray(pages)||!pages.length||pages.length>150||pages.some(p=>typeof p!=='string')||pages.reduce((n,p)=>n+p.length,0)>1500000)throw Error('Provide 1–150 text pages totaling up to 1.5 million characters.')
  const lines=pages.flatMap((p,i)=>p.split(/\r?\n/).map(text=>({page:i+1,text:text.trim(),box:[0,0,0,0]})).filter(l=>l.text))
  return resultFor(pages,lines)
}
function resultFor(pages,lines){
  const {items,checks,review_flags,extraction_status}=analyzeLines(lines)
  const receipt=receiptCheck(items)
  const sparse=pages.flatMap((p,i)=>p.trim().length<24?[i+1]:[])
  return {pages:pages.length,coverage:pages.map((_,i)=>({page:i+1,observations:items.filter(f=>f.source.page===i+1).length})),extraction_status:sparse.length&&items.length?'partial':extraction_status,review_flags:sparse.length?[...review_flags,'sparse_page']:review_flags,
    arithmetic_checks:checks.map(({total,operands,...check})=>check),receipt_check:receipt?(({total,operands,...check})=>check)(receipt):null,findings:items.map(({source,...f})=>{
      const {words,box,rawText,...evidence}=source
      return {...f,source:{...evidence,...(box?.some(Boolean)?{box}:{})}}
    }),needs_ocr:sparse}

}
async function pdfAnalysis(bytes,readPdf){
  if(!bytes.length||bytes.length>byteLimit||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Provide a valid PDF up to 8 MiB.')
  const pages=await readPdf(bytes)
  return resultFor(pages.map(p=>p.text),pages.flatMap(p=>p.lines))
}
export async function boundedBody(req,maxBytes=byteLimit){
  if(Number(req.headers.get('Content-Length'))>maxBytes)throw Error(`Request exceeds ${maxBytes/1024/1024} MiB.`)
  const reader=req.body?.getReader()
  if(!reader)throw Error('Request body required.')
  let size=0
  const chunks=[]
  while(true){
    const {done,value}=await reader.read()
    if(done)break
    size+=value.length
    if(size>maxBytes){await reader.cancel();throw Error(`Request exceeds ${maxBytes/1024/1024} MiB.`)}
    chunks.push(value)
  }
  const result=new Uint8Array(size)
  let offset=0
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}
  return result
}
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
export async function service(req,readPdf,bridge){
  const path=new URL(req.url).pathname
  if(!['/api/v2','/api/v2/analyze','/mcp'].includes(path))return
  if(req.method==='GET'&&path==='/api/v2')return json({name:'Folio',version:3,analyze:{method:'POST',path:'/api/v2/analyze',inputs:['application/pdf (binary)','application/json {"pages":["line-separated page text"]}'],limit:'8 MiB, 150 pages'},mcp:{method:'POST',path:'/mcp',protocol:'2026-07-28',tools:[...Object.keys(inputs),...Object.keys(workspaceTools).filter(name=>bridge?.allowed(name))]},review:'All findings require source verification. needs_ocr lists pages with insufficient extractable text.'})
  if(req.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}})
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==new URL(req.url).origin)return json({error:'Origin rejected'},403)
  let msg
  try{
    const body=await boundedBody(req)
    if(path==='/api/v2/analyze'&&req.headers.get('Content-Type')?.split(';')[0]==='application/pdf')return json(await pdfAnalysis(body,readPdf))
    try{msg=JSON.parse(new TextDecoder().decode(body))}catch{return json({error:'Invalid JSON'},400)}
    if(path==='/api/v2/analyze')return json(textAnalysis(msg?.pages))
    if(path!=='/mcp')return json({error:'Unknown operation'},404)
    if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},400)
    const wireVersion = req.headers.get('MCP-Protocol-Version')
    const envelopeVersion = msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ??
      msg._meta?.['io.modelcontextprotocol/protocolVersion']
    const modern = wireVersion==='2026-07-28' || envelopeVersion==='2026-07-28'
    const cache = modern ? {ttlMs:0,cacheScope:'PRIVATE'} : {}
    const serverInfo = {name:'folio',version:'3.0.0'}
    const capabilities = {tools:{},...(bridge ? {resources:{},extensions:{[tasksExtension]:{},[uiExtension]:{mimeTypes:[appMime]}}} : {})}
    const reply=result=>json({jsonrpc:'2.0',id:msg.id,result:modern ? {
      ...result,_meta:{...result._meta,'io.modelcontextprotocol/serverInfo':serverInfo},
    } : result})
    const error=(code,message,status=200)=>json({jsonrpc:'2.0',id:msg.id,error:{code,message}},status)
    if(modern && (wireVersion!=='2026-07-28' || envelopeVersion && envelopeVersion!==wireVersion || req.headers.get('Mcp-Method')!==msg.method ||
      msg.method==='tools/call' && req.headers.get('Mcp-Name')!==msg.params?.name ||
      msg.method==='resources/read' && req.headers.get('Mcp-Name')!==msg.params?.uri)) {
      return error(-32020,'MCP routing headers must match the request.',400)
    }
    if(msg.method.startsWith('notifications/')&&msg.id===undefined)return new Response(null,{status:202})
    if(msg.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities,...cache})
    if(msg.method==='initialize' && !modern) return reply({protocolVersion:['2025-11-25','2025-06-18','2025-03-26'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',capabilities,serverInfo})
    if(msg.method==='ping')return reply({})
    if(msg.method==='resources/list' && bridge)return reply({resources:[...resources,...appResources],...cache})
    if(msg.method==='resources/read' && bridge && msg.params?.uri===cardUri)return reply({...cache,contents:[{uri:cardUri,mimeType:appMime,text:verificationCard()}]})
    if(msg.method.startsWith('tasks/') && bridge){
      const outcome=taskMethod(msg.method,msg.params)
      if(!outcome)return error(-32601,'Unknown method')
      if(outcome.error)return error(-32602,outcome.error)
      return reply(msg.method==='tasks/result' ? {...outcome.result,_meta:{...outcome.result._meta,'io.modelcontextprotocol/related-task':{taskId:outcome.task.taskId}}} : outcome)
    }
    if(msg.method==='resources/read' && bridge){
      const resource=resources.find(value=>value.uri===msg.params?.uri)
      if(!resource)return error(-32002,'Unknown resource.')
      try {
        const result=await bridge.call(resource.uri)
        return reply({...cache,contents:[{uri:resource.uri,mimeType:resource.mimeType,text:JSON.stringify(result)}]})
      } catch(cause) {return error(-32002,cause.message)}
    }
    if(msg.method==='tools/list'){
      const definitions={...inputs,...Object.fromEntries(Object.entries(workspaceTools).filter(([name])=>bridge?.allowed(name)))}
      return reply({...cache,tools:Object.entries(definitions).sort(([a],[b])=>a.localeCompare(b)).map(([name,d])=>({name,...d}))})
    }
    if(msg.method==='tools/call'){
      const args=msg.params?.arguments
      try{
        let result
        const name=msg.params?.name
        if(Object.hasOwn(workspaceTools,name)&&bridge){
          if(args!==undefined&&(!args||typeof args!=='object'||Array.isArray(args)))throw Error('Tool arguments must be an object.')
          const agent=msg.params?._meta?.['io.modelcontextprotocol/clientInfo']?.name ??
            msg._meta?.['io.modelcontextprotocol/clientInfo']?.name
          const caller=typeof agent==='string' ? agent.slice(0,120) : 'Agent'
          if(msg.params?.task!==undefined){
            if(workspaceTools[name].execution?.taskSupport!=='optional')throw Error('This tool does not support task-augmented calls.')
            if(!bridge.allowed(name))throw Error('Tool consent is disabled.')
            return reply({task:createTask(()=>bridge.call(name,args,caller,true).then(value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value})),msg.params.task?.ttl)})
          }
          const input=name==='propose_finding_edit' ? {...args,...elicitedContext(msg.params,name)} : args
          result=await bridge.call(name,input,caller,true)
          if(result?.input_required){
            if(modern)return reply(inputRequired(result.input_required,{tool:name,finding_id:args?.finding_id}))
            throw Error(result.input_required.message+' Pass arguments.context with '+result.input_required.fields.join(' and ')+'.')
          }
          return reply({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result})
        }
        if(msg.params?.name==='analyze_text')result=textAnalysis(args?.pages)
        else if(msg.params?.name==='analyze_pdf'&&typeof args?.pdf_base64==='string')result=await pdfAnalysis(Uint8Array.from(atob(args.pdf_base64),c=>c.charCodeAt(0)),readPdf)
        else throw Error('Unknown tool or invalid arguments.')
        const {metric,page,offset=0,limit}=args
        if((metric!==undefined&&typeof metric!=='string')||(page!==undefined&&(!Number.isInteger(page)||page<1))||!Number.isInteger(offset)||offset<0||(limit!==undefined&&(!Number.isInteger(limit)||limit<1)))throw Error('Invalid result selection.')
        const matched=result.findings.filter(f=>(!metric||f.metric===metric)&&(!page||f.source.page===page))
        result.findings=matched.slice(offset,limit===undefined?undefined:offset+limit)
        result.matched_count=matched.length
        result.next_offset=offset+result.findings.length<matched.length?offset+result.findings.length:null
        return reply({content:[{type:'text',text:JSON.stringify(result)}]})
      }catch(e){return reply({isError:true,content:[{type:'text',text:e.message}]})}
    }
    return json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Unknown method'}})
  }catch(e){return json({error:e.message},e.message.includes('exceeds')?413:422)}
}
