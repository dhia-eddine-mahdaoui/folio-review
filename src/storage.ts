import type {Figure, Header, RecordFile} from './register'

let worker:Worker | undefined
let sequence = 0
const requests = new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void}>()

export function sqlite<T>(operation:string, params:Record<string,unknown> = {}, transfer:Transferable[] = []):Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./storage.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage = ({data:{id,result,error}}) => {
      const pending = requests.get(id)
      requests.delete(id)
      if (error) pending?.reject(Error(error))
      else pending?.resolve(result)
    }
    worker.onerror = event => {
      for (const request of requests.values()) request.reject(Error(event.message || 'SQLite worker unavailable.'))
      requests.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++sequence
  return new Promise((resolve,reject)=>{
    requests.set(id,{resolve,reject})
    worker!.postMessage({id,operation,...params},transfer)
  })
}

export async function putSqlite(record:RecordFile,header:Header,existing=false) {
  const {file,...data} = record
  const pdf = existing ? undefined : await file.arrayBuffer()
  await sqlite('put',{key:record.id,header:JSON.stringify(header),record:JSON.stringify(data),pdf,figures:record.figures},pdf ? [pdf] : [])
}

export async function getSqlite(id:string):Promise<RecordFile|undefined> {
  const row = await sqlite<{record:string;pdf:Uint8Array<ArrayBuffer>}|undefined>('get',{key:id})
  if (!row) return
  const record = JSON.parse(row.record)
  return {...record,file:new File([row.pdf],record.name,{type:'application/pdf'})}
}

export type RegisterEntry = {id:string; document:string; figure:Figure}
export async function registerSqlite(query:string,source:string):Promise<RegisterEntry[]> {
  const rows = await sqlite<{id:string;document:string;payload:string}[]>('register',{query,source})
  return rows.map(({id,document,payload})=>({id,document,figure:JSON.parse(payload)}))
}
