import {execFile,spawn} from 'node:child_process'
import {access} from 'node:fs/promises'
import {join} from 'node:path'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'

const cwd=fileURLToPath(new URL('../',import.meta.url))
const url='http://127.0.0.1:8031'
const execute=promisify(execFile)
const options={cwd,detached:true,stdio:'ignore',windowsHide:true}
const windows=process.platform==='win32'

async function ready(){
  try{
    const response=await fetch(url+'/api/v2',{signal:AbortSignal.timeout(600)})
    return response.ok&&(await response.json()).name==='Folio'
  }catch{return false}
}
function launch(file,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,options)
    child.once('error',reject)
    child.once('spawn',()=>{child.unref();resolve()})
  })
}

async function appBrowser(){
  if(windows){
    const {stdout}=await execute('reg.exe',['query',
      'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice','/v','ProgId'],
      {windowsHide:true,timeout:2000}).catch(()=>({stdout:''}))
    const id=stdout.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1]??''
    const browser=
      /^MSEdgeHTM/i.test(id)?['Microsoft','Edge','Application','msedge.exe']:
      /^ChromeHTML/i.test(id)?['Google','Chrome','Application','chrome.exe']:
      /^BraveHTML/i.test(id)?['BraveSoftware','Brave-Browser','Application','brave.exe']:null
    if(!browser)return
    for(const folder of [process.env.LOCALAPPDATA,process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean)){
      const executable=join(folder,...browser)
      if(await access(executable).then(()=>true,()=>false))return executable
    }
    return
  }

  const {stdout}=await execute('xdg-settings',['get','default-web-browser'],{timeout:2000}).catch(()=>({stdout:''}))
  const name=stdout.trim()
  const browsers={
    'google-chrome.desktop':['google-chrome','google-chrome-stable'],
    'chromium.desktop':['chromium','chromium-browser'],
    'chromium-browser.desktop':['chromium-browser','chromium'],
    'microsoft-edge.desktop':['microsoft-edge','microsoft-edge-stable'],
    'brave-browser.desktop':['brave-browser'],
  }
  for(const executable of browsers[name]??[]){
    if(await execute('which',[executable],{timeout:1000}).then(()=>true,()=>false))return executable
  }
}

if(!await ready()){
  await launch(process.execPath,['server/local.js'])
  for(let attempt=0;attempt<40&&!await ready();attempt++)await new Promise(resolve=>setTimeout(resolve,200))
}
if(!await ready())throw Error('Folio could not start on local port 8031.')
const browser=await appBrowser()
const opened=browser&&await launch(browser,['--app='+url]).then(()=>true,()=>false)
if(!opened)await launch(windows?'rundll32.exe':'xdg-open',windows?['url.dll,FileProtocolHandler',url]:[url])
