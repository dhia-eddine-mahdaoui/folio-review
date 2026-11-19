import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const cwd=fileURLToPath(new URL('../',import.meta.url))
const url='http://127.0.0.1:8031'
async function ready(){
  try{return (await (await fetch(url+'/api/v2',{signal:AbortSignal.timeout(600)})).json()).name==='Folio'}catch{return false}
}
if(!await ready()){
  const child=spawn(process.execPath,['server/local.js'],{cwd,detached:true,stdio:'ignore',windowsHide:true})
  child.unref()
  for(let i=0;i<40&&!await ready();i++)await new Promise(r=>setTimeout(r,200))
}
if(!await ready())throw Error('Folio could not start on local port 8031.')
const windows=process.platform==='win32'
spawn(windows?'rundll32.exe':'xdg-open',windows?['url.dll,FileProtocolHandler',url]:[url],{detached:true,stdio:'ignore',windowsHide:true}).unref()
