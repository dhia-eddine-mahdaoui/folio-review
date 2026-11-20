import {mkdir,readFile,writeFile,rename,unlink,rmdir,stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'

const root=fileURLToPath(new URL('../',import.meta.url))
const home=homedir()
const folders=[
 ['Codex',process.env.CODEX_HOME||join(home,'.codex')],
 ['Claude Code',process.env.CLAUDE_CONFIG_DIR||join(home,'.claude')],
 ['Gemini CLI',join(home,'.gemini')],
 ['Cursor',join(home,'.cursor')]
]
const win=process.platform==='win32'
const command=win?'& "'+join(root,'folio.cmd')+'"':"'"+join(root,'folio').replaceAll("'","'\\''")+"'"
const template=await readFile(new URL('skills/folio-review/SKILL.md',import.meta.url),'utf8')
const content=template.replace('{{FOLIO_COMMAND}}',()=>command)
const hash=s=>createHash('sha256').update(s).digest('hex')
const manifest=join(root,'installed-agent-skills.json')
async function optional(path){
  try{return await readFile(path,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}
}
async function atomic(path,text){
  const temp=path+'.'+randomUUID()+'.tmp'
  await writeFile(temp,text,{flag:'wx',mode:0o600})
  try{await rename(temp,path)}finally{await unlink(temp).catch(()=>{})}
}
const skillPath=dir=>join(dir,'skills','folio-review','SKILL.md')
const isDirectory=async dir=>(await stat(dir).catch(()=>null))?.isDirectory()===true
async function installedRuntime(){
  return (await stat(join(root,win?'folio.cmd':'folio')).catch(()=>null))?.isFile()===true
}
export async function agentStatus(){
  const receipt=JSON.parse(await optional(manifest)??'{}')
  return {template:content,installedRuntime:await installedRuntime(),agents:await Promise.all(folders.map(async ([name,dir])=>{
    const dest=skillPath(dir)
    const existing=await optional(dest)
    return {name,detected:await isDirectory(dir),installed:existing!==null,managed:existing!==null&&hash(existing)===receipt[dest],skill:existing}
  }))}
}
let operation=Promise.resolve()
export function configureAgents(action,target=null,instructions=''){
  const run=operation.then(async()=>{
    const receipt=JSON.parse(await optional(manifest)??'{}')
    const remove=action==='remove'
    if(!remove&&!await installedRuntime())throw Error('Install Folio Desktop to manage local agent skills.')
    const targets=target?folders.filter(([name])=>name===target).map(([name,dir])=>[name,dir,skillPath(dir)]):
      remove?Object.keys(receipt).map(path=>['installed agent',dirname(dirname(dirname(path))),path]):
        folders.map(([name,dir])=>[name,dir,skillPath(dir)])
    const replacement=instructions?content.trimEnd()+'\n\n## Workspace instructions\n\n'+instructions+'\n':content
    for(const [name,dir,dest] of targets){
      if(!remove&&!await isDirectory(dir)){if(target)throw Error(name+' profile was not detected.');continue}
      const existing=await optional(dest)
      if(!remove&&!target&&existing?.includes('\n## Workspace instructions\n')&&hash(existing)===receipt[dest])continue
      if(remove&&!receipt[dest])continue
      if(existing!==null&&hash(existing)!==receipt[dest]&&existing!==replacement){
        if(target)throw Error('This skill has local edits. Folio preserved the existing file.')
        console.error('Preserved existing skill at '+dest);continue
      }
      if(remove){
        if(existing!==null){await unlink(dest);await rmdir(dirname(dest)).catch(()=>{})}
        delete receipt[dest]
      }else{
        await mkdir(dirname(dest),{recursive:true})
        if(existing===null)await writeFile(dest,replacement,{flag:'wx',mode:0o600})
        else if(existing!==replacement)await atomic(dest,replacement)
        receipt[dest]=hash(replacement)
        if(!target)console.log(name+' skill: '+dest)
      }
      await atomic(manifest,JSON.stringify(receipt,null,2))
    }
  })
  operation=run.catch(()=>{})
  return run
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await configureAgents(process.argv[2]==='remove'?'remove':'install')
}
