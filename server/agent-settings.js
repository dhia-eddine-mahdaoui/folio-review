import {agentStatus,configureAgents} from '../desktop/agents.mjs'

const names=['Codex','Claude Code','Gemini CLI','Cursor']
const json=(response,status=200)=>Response.json(response,{status,headers:{'Cache-Control':'no-store'}})

export async function agentSettings(req,origin){
  if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return json({error:'Origin rejected'},403)
  try{
    if(req.method==='GET')return json(await agentStatus())
    if(req.method!=='POST')return json({error:'Method unavailable'},405)
    if(req.headers.origin!==origin||req.headers['content-type']!=='application/json')return json({error:'Origin rejected'},403)
    const chunks=[]
    let size=0
    for await(const chunk of req){
      size+=chunk.length
      if(size>8192)return json({error:'Instructions exceed the size limit'},413)
      chunks.push(chunk)
    }
    const {action,name,instructions=''}=JSON.parse(Buffer.concat(chunks).toString())
    if(!['install','remove'].includes(action)||!names.includes(name)||typeof instructions!=='string'||instructions.length>4000){
      return json({error:'Invalid skill settings'},400)
    }
    await configureAgents(action,name,instructions.trim())
    return json(await agentStatus())
  }catch(error){
    return json({error:error.message},422)
  }
}
