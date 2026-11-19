import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Minus, Plus, ScanLine } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { type Evidence } from './model'

GlobalWorkerOptions.workerSrc = workerUrl

export function Document({ url, filename, page, pages, onPage, source, onRegion }: {
  url: string
  filename: string
  page: number
  pages: number
  onPage: (page: number) => void
  onRegion?: (box: Evidence["box"]) => void
  source?: Evidence
}) {
  const [marking, mark] = useState(false)
  const [outline, outlineBox] = useState<Evidence['box']>()
  const start = useRef<[number,number] | undefined>(undefined)
  const point = (event: React.PointerEvent<HTMLDivElement>):[number,number] => {
    const rect=event.currentTarget.getBoundingClientRect()
    return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))]
  }
  const region = (end:[number,number]):Evidence['box'] => {
    const [x,y]=start.current!
    return [Math.min(x,end[0]),Math.min(y,end[1]),Math.max(x,end[0]),Math.max(y,end[1])]
  }
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [rendered, setRendered] = useState<{ document: PDFDocumentProxy; page: number }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    if (holder.current) observer.observe(holder.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setError('')
    setDocument(undefined)
    let active = true
    const task = getDocument({ url, standardFontDataUrl: '/pdf-fonts/' })
    task.promise.then(pdf => { if (active) setDocument(pdf) })
      .catch(() => { if (active) setError('Unable to open this PDF preview.') })
    return () => { active = false; void task.destroy().catch(() => {}) }
  }, [url])
  useEffect(() => {
    if (!document || !canvas.current || !width) return
    let active = true
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    const target = canvas.current
    setError('')
    setRendered(undefined)
    document.getPage(page).then(pdfPage => {
      if (!active) return
      const base = pdfPage.getViewport({ scale: 1 })
      const displayWidth = Math.max(180, Math.min(width, 920) * zoom / 100)
      const view = pdfPage.getViewport({ scale: displayWidth / base.width })
      const density = Math.min(window.devicePixelRatio || 1, 2)
      target.width = Math.ceil(view.width * density)
      target.height = Math.ceil(view.height * density)
      target.style.width = `${view.width}px`
      target.style.height = `${view.height}px`
      task = pdfPage.render({ canvas: target, viewport: view, transform: [density, 0, 0, density, 0, 0] })
      return task.promise.then(() => { if (active) setRendered({ document, page }) })
    }).catch(() => { if (active) setError('Unable to render this page.') })
    return () => { active = false; task?.cancel() }
  }, [document, page, width, zoom])
  const box = outline ?? (rendered?.document === document && rendered?.page === page && source?.page === page ? source.box : undefined)
  return <section className="document panel" aria-label="Source document">
    <div className="document-head">
      <span className="file-icon"><FileText size={19}/></span>
      <span className="file-name"><strong>{filename}</strong><small>Source document · PDF</small></span>
      <a className="icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Open original PDF in a new tab" title="Open original PDF"><ExternalLink size={16}/></a>
    </div>
    <div className="document-tools">
      {onRegion&&<button type="button" aria-pressed={marking} onClick={()=>{mark(!marking);outlineBox(undefined);start.current=undefined}}><ScanLine size={16}/>{marking?'Cancel selection':'Select area'}</button>}
      <div className="tool-group">
        <button className="icon-button" aria-label="Previous PDF page" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft size={16}/></button>
        <form className="page-count" key={page} onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('page') as HTMLInputElement; onPage(Number(input.value)); input.blur() }}><input aria-label="Jump to PDF page" name="page" type="number" required min={1} max={pages} defaultValue={page}/> / {pages}</form>
        <button className="icon-button" aria-label="Next PDF page" onClick={() => onPage(page + 1)} disabled={page >= pages}><ChevronRight size={16}/></button>
      </div>
      <div className="tool-group">
        <button className="icon-button" aria-label="Zoom out" onClick={() => setZoom(zoom - 25)} disabled={zoom <= 75}><Minus size={14}/></button>
        <span className="zoom-level">{zoom}%</span>
        <button className="icon-button" aria-label="Zoom in" onClick={() => setZoom(zoom + 25)} disabled={zoom >= 175}><Plus size={14}/></button>
      </div>
    </div>
    <div className="paper-container"><div className="paper-width" ref={holder}>
      {error && <p className="paper-error" role="alert">{error} <a href={url} target="_blank" rel="noreferrer">Open the PDF</a></p>}
      <div className="paper" hidden={!!error}>
        <canvas ref={canvas} aria-label={`PDF page ${page}`}/>
        {marking && <div className="region-select" aria-label="Drag to select evidence" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start.current=point(e)}} onPointerMove={e=>{if(start.current)outlineBox(region(point(e)))}} onPointerCancel={()=>{start.current=undefined;outlineBox(undefined)}} onPointerUp={e=>{
          if(!start.current)return
          const selected=region(point(e));start.current=undefined;outlineBox(undefined)
          if(selected[2]-selected[0]>.005&&selected[3]-selected[1]>.005){mark(false);onRegion?.(selected)}
        }}/>}
        {box && <div className="highlight" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}/>}
      </div>
    </div></div>
    <div className="document-foot"><span className="key-swatch"/> {box ? 'Highlighted source evidence' : 'Navigate the PDF or select a source from the review'}</div>
  </section>
}
