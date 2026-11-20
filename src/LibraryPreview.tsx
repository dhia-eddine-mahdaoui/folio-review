import {useEffect, useState} from 'react'
import {Button} from '@astryxdesign/core/Button'
import {ArrowRight} from 'lucide-react'
import {Document} from './Document'
import {get, type Header} from './register'

export function LibraryPreview({item, sampleName, disabled, onOpen}: {
  item?: Header
  sampleName: string
  disabled: boolean
  onOpen: () => void
}) {
  const [page, setPage] = useState(1)
  const [url, setUrl] = useState(item ? '' : '/northfield-sample.pdf')
  const [error, setError] = useState(false)
  const id = item?.id
  useEffect(() => {
    if (!id) return
    let active = true
    let objectUrl: string | undefined
    void get(id).then(record => {
      if (!active) return
      if (!record) throw Error()
      objectUrl = URL.createObjectURL(record.file)
      setUrl(objectUrl)
    }).catch(() => {if (active) setError(true)})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])
  const title = item?.name ?? sampleName
  return <aside className="library-preview" aria-labelledby="library-preview-heading">
    <div className="preview-bar">
      <div><h2 id="library-preview-heading" title={title}>{item ? title : 'Northfield Components'}</h2>
        <p>{item ? `${item.pages} ${item.pages === 1 ? 'page' : 'pages'} · ${item.count} verified` : 'Sample report · 2 pages'}</p></div>
      <Button size="sm" variant="secondary" label={item ? 'Open workpaper' : 'Open sample report'}
        endContent={<ArrowRight size={14}/>} isDisabled={disabled} onClick={onOpen}/>
    </div>
    {url ? <Document url={url} filename={title} page={page} pages={item?.pages ?? 2} onPage={setPage} preview/> :
      <div className="preview-loading" role={error ? 'alert' : 'status'}>{error ? 'Preview unavailable' : 'Opening preview…'}</div>}
  </aside>
}
