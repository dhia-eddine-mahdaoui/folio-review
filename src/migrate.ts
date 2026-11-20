import {get, list} from './register'
import {preferencesKey} from './preferences'

// Folio 3.0 runs on http://localhost so passkeys work. Browser storage is per origin, so workpapers saved under
// http://127.0.0.1 are moved once: the localhost page opens the old origin, which posts back verified .folio archives.
export const legacyOrigin = () => location.protocol+'//127.0.0.1'+(location.port ? ':'+location.port : '')
export const migrationKey = 'folio-legacy-library'
const exportHash = '#export-library'

type Archive = {name:string; bytes:Uint8Array}
type Message = {type:'folio-migration'; archives:Archive[]; preferences:string|null} | {type:'folio-migration-empty'}

export const isLegacyExport = () => location.hash===exportHash && !!window.opener && location.hostname==='127.0.0.1'

// Runs in the popup on the old origin.
export async function exportLegacyLibrary() {
  const target = location.protocol+'//localhost'+(location.port ? ':'+location.port : '')
  const {encodeBackup} = await import('./backup')
  const archives:Archive[] = []
  for (const header of await list()) {
    if (header.sample) continue
    const record = await get(header.id)
    if (record) archives.push({name:record.name,bytes:await encodeBackup(record)})
  }
  const message:Message = archives.length ? {type:'folio-migration',archives,preferences:localStorage.getItem(preferencesKey)} : {type:'folio-migration-empty'}
  window.opener.postMessage(message,target,archives.map(archive=>archive.bytes.buffer))
  window.close()
}

// Runs on localhost: resolves with the archives received from the old origin.
export function requestLegacyLibrary():Promise<{archives:Archive[]; preferences:string|null}> {
  return new Promise((resolve,reject)=>{
    const popup = window.open(legacyOrigin()+'/'+exportHash,'folio-legacy-library','width=420,height=320')
    if (!popup) return reject(Error('Allow pop-ups for Folio to move your library.'))
    const timer = window.setTimeout(()=>{cleanup();reject(Error('The previous Folio library did not respond. Make sure Folio is running and try again.'))},60000)
    function cleanup() {window.clearTimeout(timer);window.removeEventListener('message',receive)}
    function receive(event:MessageEvent<Message>) {
      if (event.origin!==legacyOrigin() || event.source!==popup) return
      cleanup()
      if (event.data?.type==='folio-migration-empty') return resolve({archives:[],preferences:null})
      if (event.data?.type!=='folio-migration' || !Array.isArray(event.data.archives)) return reject(Error('Unexpected migration data.'))
      resolve({archives:event.data.archives,preferences:event.data.preferences})
    }
    window.addEventListener('message',receive)
  })
}
