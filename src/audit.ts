import type {AuditEvent} from './review.ts'

export function canonicalJson(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(item=>canonicalJson(item ?? null)).join(',')+']'
  if (value && typeof value==='object') {
    const entries = Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0)
    return '{'+entries.map(([key,item])=>JSON.stringify(key)+':'+canonicalJson(item)).join(',')+'}'
  }
  return JSON.stringify(value)
}

export async function sha256(bytes:BufferSource) {
  const hash = await crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')
}

export const digestJson = (value:unknown) => sha256(new TextEncoder().encode(canonicalJson(value)))
export const sourceHash = (id:string) => id.replace(/^sample-/,'')
export const genesis = '0'.repeat(64)

async function seal(event:AuditEvent, pdf:string, previous:string) {
  const {hash,prev_hash,source_pdf_sha256,...payload} = event
  const linked = {...payload,prev_hash:previous,source_pdf_sha256:pdf}
  return {...linked,hash:await digestJson(linked)}
}

export async function verifyHistory(events:AuditEvent[], pdf:string) {
  let previous = genesis
  for (const event of events) {
    const expected = await seal(event,pdf,previous)
    if (event.hash!==expected.hash || event.prev_hash!==previous || event.source_pdf_sha256!==pdf) return false
    previous = expected.hash
  }
  return true
}

export async function appendHistory(events:AuditEvent[], pdf:string, prior:AuditEvent[] = []) {
  if (prior.some((event,i)=>event!==events[i] && canonicalJson(event)!==canonicalJson(events[i] ?? null))) throw Error('The audit chain is append-only.')
  const result:AuditEvent[] = []
  for (const event of events) {
    const previous = result.at(-1)?.hash ?? genesis
    if (event.hash!==undefined) {
      if (event.prev_hash!==previous || event.source_pdf_sha256!==pdf) throw Error('Invalid audit chain link.')
      result.push(event)
    } else {
      result.push(await seal(event,pdf,previous))
    }
  }
  return result
}
