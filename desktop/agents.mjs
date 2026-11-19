import {mkdir,readFile,writeFile,rename,unlink,rmdir,stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname,join} from 'node:path'
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
const receipt=JSON.parse(await optional(manifest)??'{}')
const remove=process.argv[2]==='remove'
const targets=remove?Object.entries(receipt).map(([path])=>['installed agent',dirname(dirname(dirname(path))),path]):folders
for(const [name,dir,previous] of targets){
  if(!remove&&!(await stat(dir).catch(()=>null))?.isDirectory())continue
  const dest=previous||join(dir,'skills','folio-review','SKILL.md')
  const existing=await optional(dest)
  if(existing!==null&&hash(existing)!==receipt[dest]&&existing!==content){
    console.error('Preserved existing skill at '+dest);continue
  }
  if(remove){
    if(existing!==null){await unlink(dest);await rmdir(dirname(dest)).catch(()=>{})}
    delete receipt[dest]
  }else{
    await mkdir(dirname(dest),{recursive:true})
    if(existing===null)await writeFile(dest,content,{flag:'wx',mode:0o600})
    else if(existing!==content)await atomic(dest,content)
    receipt[dest]=hash(content);console.log(name+' skill: '+dest)
  }
  await atomic(manifest,JSON.stringify(receipt,null,2))
}
