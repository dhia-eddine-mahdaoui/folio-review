import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Minus, Plus, ScanLine } from 'lucide-react'
import {Card} from '@astryxdesign/core/Card'
import {Button} from '@astryxdesign/core/Button'
import type {PDFDocumentProxy} from 'pdfjs-dist'
import {getDocument} from './pdf'
import { type Evidence } from './model'

export type Annotation = {id:string; box:Evidence['box']; label:string; tone:'verified'|'review'|'confident'; activate:() => void}

export function Document({ url, filename, page, pages, onPage, source, onRegion, preview, annotations, selected, linked, onLink, run, formulaBoxes }: {
  url: string
  filename: string
  page: number
  pages: number
  onPage: (page: number) => void
  onRegion?: (box: Evidence["box"]) => void
  source?: Evidence
  preview?: boolean
  annotations?: Annotation[]
  selected?: string
  linked?: boolean
  run?:string
  formulaBoxes?:Evidence["box"][]
  onLink?: (id:string | undefined) => void
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
  const [size, setSize] = useState({width: 0, height: 0})
  const [zoom, setZoom] = useState(100)
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [rendered, setRendered] = useState<{ document: PDFDocumentProxy; page: number }>()
  const ready = rendered?.document === document && rendered?.page === page
  const [error, setError] = useState('')
  useEffect(() => {
    const scroller = holder.current?.parentElement
    if (!scroller) return
    const observer = new ResizeObserver(([entry]) => setSize({width:entry.contentRect.width, height:entry.contentRect.height}))
    observer.observe(scroller)
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
    if (!document || !canvas.current || !size.width) return
    let active = true
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    const visible = canvas.current
    const target = window.document.createElement('canvas')
    setError('')
    setRendered(undefined)
    document.getPage(page).then(pdfPage => {
      if (!active) return
      const base = pdfPage.getViewport({ scale: 1 })
      const fit = preview ? size.height * base.width / base.height : 920
      const displayWidth = Math.max(150, Math.min(size.width, fit) * zoom / 100)
      const view = pdfPage.getViewport({ scale: displayWidth / base.width })
      const density = Math.min(window.devicePixelRatio || 1, 2)
      target.width = Math.ceil(view.width * density)
      target.height = Math.ceil(view.height * density)
      target.style.width = `${view.width}px`
      target.style.height = `${view.height}px`
      task = pdfPage.render({ canvas: target, viewport: view, transform: [density, 0, 0, density, 0, 0] })
      return task.promise.then(() => {
        if (!active) return
        visible.width = target.width
        visible.height = target.height
        visible.style.width = target.style.width
        visible.style.height = target.style.height
        visible.getContext('2d')?.drawImage(target,0,0)
        setRendered({document,page})
        holder.current?.dispatchEvent(new CustomEvent('pagerendered',{detail:{pageNumber:page},bubbles:true}))
      })
    }).catch(() => { if (active) setError('Unable to render this page.') })
    return () => { active = false; task?.cancel() }
  }, [document, page, size, zoom, preview])
  const evidenceMark=useRef<HTMLElement>(null)
  useEffect(()=>{
    const mark=holder.current?.querySelector<HTMLElement>('[data-active-anchor]') ?? evidenceMark.current
    const scroller=holder.current?.parentElement
    if(!mark||!scroller||!rendered||!source||source.page!==rendered.page||source.box[2]<=0)return
    const offset=mark.getBoundingClientRect().top-scroller.getBoundingClientRect().top
    if(offset<0||offset>scroller.clientHeight*.8)scroller.scrollTop+=offset-scroller.clientHeight*.4
  },[rendered,source?.page,source?.box,selected])
  const box = outline ?? (ready && source?.page === page && source.box[2] > source.box[0] ? source.box : undefined)
  return <Card padding={0} className={preview ? "document preview-document" : "document"} role="region" aria-label="Source document">
    <div className="document-head">
      <strong><FileText size={17}/> {preview ? "PDF preview" : "Source PDF"}</strong>
      <Button href={url} target="_blank" rel="noreferrer" variant="ghost" size="sm"
        label={`Open ${filename} in a new tab`} tooltip="Open original PDF" icon={<ExternalLink size={15}/>} isIconOnly/>
    </div>
    <div className="document-tools">
      {onRegion && <Button label={marking ? 'Cancel selection' : 'Select area'} icon={<ScanLine size={15}/>} size="sm" aria-pressed={marking}
        onClick={() => { mark(!marking); outlineBox(undefined); start.current = undefined }}/>}
      <div className="tool-group">
        <Button label="Previous PDF page" icon={<ChevronLeft size={16}/>} variant="ghost" size="sm" isIconOnly
          onClick={() => onPage(page - 1)} isDisabled={page <= 1}/>
        <form className="page-count" key={page} onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('page') as HTMLInputElement; onPage(Number(input.value)); input.blur() }}>
          <input aria-label="Jump to PDF page" name="page" type="number" required min={1} max={pages} defaultValue={page}/> / {pages}
        </form>
        <Button label="Next PDF page" icon={<ChevronRight size={16}/>} variant="ghost" size="sm" isIconOnly
          onClick={() => onPage(page + 1)} isDisabled={page >= pages}/>
      </div>
      <div className="tool-group">
        <Button label="Zoom out" icon={<Minus size={14}/>} variant="ghost" size="sm" isIconOnly onClick={() => setZoom(zoom - 25)} isDisabled={zoom <= 75}/>
        <span className="zoom-level">{zoom}%</span>
        <Button label="Zoom in" icon={<Plus size={14}/>} variant="ghost" size="sm" isIconOnly onClick={() => setZoom(zoom + 25)} isDisabled={zoom >= 175}/>
      </div>
    </div>
    <div className="paper-container"><div className="paper-width" ref={holder}>
      {error && <p className="paper-error" role="alert">{error} <a href={url} target="_blank" rel="noreferrer">Open the PDF</a></p>}
      <div className="paper" hidden={!!error} data-rendered-page={ready ? page : undefined}>
        <canvas ref={canvas} aria-label={`PDF page ${page}`}/>
        {marking && <div className="region-select" aria-label="Drag to select evidence" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start.current=point(e)}} onPointerMove={e=>{if(start.current)outlineBox(region(point(e)))}} onPointerCancel={()=>{start.current=undefined;outlineBox(undefined)}} onPointerUp={e=>{
          if(!start.current)return
          const selected=region(point(e));start.current=undefined;outlineBox(undefined)
          if(selected[2]-selected[0]>.005&&selected[3]-selected[1]>.005){mark(false);onRegion?.(selected)}
        }}/>}
        {!marking && ready && annotations?.map(annotation => {
          const [left,top,right,bottom] = annotation.box
          const active = selected === annotation.id
          return <button type="button" key={(run ?? 'legacy')+':'+annotation.id} className={`evidence-box ${annotation.tone}${active && linked ? ' linked' : ''}`}
            data-active-anchor={active ? '' : undefined} aria-label={annotation.label} aria-pressed={active}
            title={annotation.label} onClick={annotation.activate}
            onMouseEnter={() => onLink?.(annotation.id)} onMouseLeave={() => onLink?.(undefined)}
            onFocus={() => onLink?.(annotation.id)} onBlur={() => onLink?.(undefined)}
            style={{left:`${left*100}%`,top:`${top*100}%`,width:`${(right-left)*100}%`,height:`${(bottom-top)*100}%`}}/>
        })}
        {!marking && ready && !!formulaBoxes?.length && <svg className="formula-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          {formulaBoxes.slice(1).map(([x,y,r,b],i)=>{
            const [tx,ty,tr,tb] = formulaBoxes[0]
            const outer = Math.min(985,Math.max(tr,r)*1000+24+i*8)
            return <path key={i} d={`M ${r*1000},${(y+b)*500} H ${outer} V ${(ty+tb)*500} H ${tr*1000}`}/>
          })}
          {formulaBoxes.map(([x,y,r,b],i)=><rect key={i} x={x*1000} y={y*1000} width={(r-x)*1000} height={(b-y)*1000} data-total={i===0}/>)}
        </svg>}
        {box && !(!marking && annotations?.some(annotation => annotation.id === selected)) &&
          <div ref={node => {evidenceMark.current = node}} className={`highlight${linked ? ' linked' : ''}`}
            data-active-anchor={!outline ? '' : undefined}
            style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}/>}
      </div>
    </div></div>
    {!preview && <div className="document-foot">
      <span><i className="key-swatch verified"/> Verified / clear source</span>
      <span><i className="key-swatch"/> Review required</span>
    </div>}
  </Card>
}
