import {useEffect, useRef, useState} from 'react'
import {Button} from '@astryxdesign/core/Button'
import {X} from 'lucide-react'
import {Document} from './Document'
import type {TieOut, TieOutSide} from './tieout'

export function TieOutSplit({tie, file, documentKey, filename, pages, onClose}: {
  tie:TieOut; file:Blob; documentKey:string; filename:string; pages:number; onClose:()=>void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [path,setPath] = useState('')
  useEffect(()=>{
    const container = grid.current
    if (!container) return
    let frame = 0
    function draw() {
      const marks = [...container!.querySelectorAll<HTMLElement>('[data-tie-side] [data-active-anchor]')]
      if (marks.length!==2) return setPath('')
      const [a,b] = marks.map(mark=>mark.getBoundingClientRect())
      const box = container!.getBoundingClientRect()
      if (!a.width || !b.width) return setPath('')
      const x1 = a.right-box.left, y1 = a.top+a.height/2-box.top, x2 = b.left-box.left, y2 = b.top+b.height/2-box.top
      const mid = (x1+x2)/2
      setPath(`M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`)
    }
    const update = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(draw)}
    const observer = new ResizeObserver(update)
    observer.observe(container)
    container.addEventListener('scroll',update,true)
    container.addEventListener('pagerendered',update)
    update()
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();container.removeEventListener('scroll',update,true);container.removeEventListener('pagerendered',update)}
  },[tie])
  const side = (value:TieOutSide, name:'a'|'b') => <div className="tieout-side" data-tie-side={name}>
    <Document file={file} documentKey={documentKey+':'+name} filename={filename} pages={pages} page={value.page} onPage={()=>{}} tools={false}
      title={`Page ${value.page} · ${value.finding.source_label ?? value.finding.label}`}
      source={{page:value.page,quote:value.finding.source.text,box:value.finding.source.box,value:value.amount,basis:''}}/>
  </div>
  return <section className={'tieout-split'+(tie.failed ? ' failed' : '')} aria-label="Cross-page tie-out split view">
    <header className="tieout-bar">
      <div><strong>Cross-page tie-out</strong><span>{tie.metric} · {tie.period}</span></div>
      <p className={tie.failed ? 'tieout-variance' : undefined} role="status">
        {tie.failed ? <>Variance {tie.difference.replace(/^-/,"")} {tie.unit}</> : "Values agree"}
        <span className="tabular"> · p. {tie.a.page} {tie.a.amount} {tie.failed ? '≠' : '='} p. {tie.b.page} {tie.b.amount}</span>
      </p>
      <Button size="sm" variant="ghost" label="Close split view" icon={<X size={15}/>} isIconOnly onClick={onClose}/>
    </header>
    <div className="tieout-grid" ref={grid}>
      {side(tie.a,'a')}{side(tie.b,'b')}
      {path && <svg className="tieout-connector" aria-hidden="true"><path d={path}/></svg>}
    </div>
  </section>
}
