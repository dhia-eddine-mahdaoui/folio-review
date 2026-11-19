import type { Decisions, Review } from './model'

export type Draft = { file: File; review: Review; decisions: Decisions }
let database: Promise<IDBDatabase> | undefined
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-private-workspace', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('review')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}
export async function readDraft(): Promise<Draft | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const read = db.transaction('review').objectStore('review').get('active')
    read.onsuccess = () => resolve(read.result)
    read.onerror = () => reject(read.error)
  })
}
export async function writeDraft(draft?: Draft) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('review', 'readwrite')
    const store = tx.objectStore('review')
    if (draft) store.put(draft, 'active')
    else store.delete('active')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}
