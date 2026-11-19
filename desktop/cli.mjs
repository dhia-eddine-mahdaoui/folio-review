import {open} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {service} from '../server/service.js'
import {read} from '../server/read-local.js'

console.log=console.error
try{
  const [action,name]=process.argv.slice(2)
  if(action!=='analyze'||!name)throw Error('Usage: folio analyze <file.pdf>')
  const path=resolve(name)
  process.chdir(fileURLToPath(new URL('../',import.meta.url)))
  const file=await open(path,'r')
  let bytes
  try{
    const {size}=await file.stat()
    if(size>8*1024*1024)throw Error('PDF exceeds 8 MiB.')
    bytes=await file.readFile()
  }finally{await file.close()}
  const response=await service(new Request('http://localhost/api/v2/analyze',{method:'POST',headers:{'Content-Type':'application/pdf'},body:bytes}),read)
  const result=await response.json()
  if(!response.ok)throw Error(result.error)
  process.stdout.write(JSON.stringify(result,null,2)+'\n')
}catch(error){console.error(error.message);process.exitCode=1}
