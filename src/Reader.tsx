import {useEffect, useMemo, useRef, useState} from 'react'
import {AlertDialog} from '@astryxdesign/core/AlertDialog'
import {Card} from '@astryxdesign/core/Card'
import {Button} from '@astryxdesign/core/Button'
import {Badge} from '@astryxdesign/core/Badge'
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl'
import {Tab, TabList} from '@astryxdesign/core/TabList'
import {ArrowLeft, ArrowUpRight, Check, ChevronRight, ClipboardCheck, Crosshair, FileText, ScanLine, Search, ShieldAlert} from 'lucide-react'
import {analyzeLines, receiptCheck, type Finding} from './findings'
import {Document, type Annotation} from './Document'
import {change, downloadRegister, indexedRegion, readRegion, scanPage, type Figure, type Line, type RecordFile} from './register'
import {defaultReasons, findingKey, findingStatus, priorities, reviewedFinding, workpaperFindings, type Assignment, type AuditEvent, type Disposition, type Priority} from './review'
import type {Preferences} from './preferences'
import {WorkpaperRegister} from './WorkpaperRegister'

type TabName = 'Verify' | 'Queue' | 'Search'
type Capture = {line:Line; figure?:Figure; finding?:Finding; manualId?:string}
type Rule = {name:string; total:Finding; operands:{finding:Finding; sign:number}[]}
const captureFinding = (finding:Finding, figures:Figure[]): Capture => {
  const figure = reviewedFinding(finding,figures)
  return {finding,figure,line:figure?.source ?? finding.source}
}
function nextFinding(doc:RecordFile) {
  return workpaperFindings(analyzeLines(doc.lines).items, doc.figures, doc.exclusions, doc.assignments)
    .find(finding => findingStatus(finding, doc.figures, doc.exclusions) === 'To review')
}

export function Reader({initial, initialFigure, back, settings, onChange}: {
  initial:RecordFile; initialFigure?:string; back:()=>void; settings:Preferences; onChange:()=>void
}) {
  const [doc,setDoc] = useState(initial)
  const [selection,setSelection] = useState<Capture | undefined>(() => {
    const figure = initial.figures.find(figure => figure.id === initialFigure)
    if (figure) return {figure,line:figure.source,finding:figure.original}
    const first = nextFinding(initial)
    return first && captureFinding(first,initial.figures)
  })
  const [page,setPage] = useState(selection?.line.page ?? 1)
  const [tab,setTab] = useState<TabName>(selection ? 'Verify' : 'Queue')
  const [url,setUrl] = useState('')
  const [pane,setPane] = useState('review')
  const [queue,setQueue] = useState(selection ? 'To review' : 'All')
  const [currentReviewer,setCurrentReviewer] = useState(settings.reviewer)
  const [assignee,setAssignee] = useState('')
  const [priority,setPriority] = useState('')
  const [failure,setFailure] = useState('')
  const [query,setQuery] = useState('')
  const [limit,setLimit] = useState(40)
  const [disposition,setDisposition] = useState<Disposition>()
  const [deleting,setDeleting] = useState<string>()
  const [busy,setBusy] = useState(false)
  const [scanning,setScanning] = useState(false)
  const [error,setError] = useState('')
  const [announcement,setAnnouncement] = useState('')
  const [hover,setHover] = useState<string>()
  const [heatmap,setHeatmap] = useState(true)
  const [connector,setConnector] = useState('')
  const desk = useRef<HTMLDivElement>(null)
  const working = busy || scanning
  const {line,figure,finding} = selection ?? {}
  const key = finding && findingKey(finding)
  const anchor = figure ? 'figure-' + figure.id : key ?? selection?.manualId ?? 'capture'
  const decision = key ? doc.exclusions?.[key] : undefined
  const assignment = key ? doc.assignments?.[key] : undefined

  const analysis = useMemo(()=>analyzeLines(doc.lines),[doc.lines])
  const receipt = useMemo(()=>receiptCheck(analysis.items),[analysis])
  const rules:Rule[] = useMemo(()=>[...analysis.checks,...(receipt ? [{name:'Receipt total',...receipt}] : [])],[analysis,receipt])
  const findings = useMemo(()=>workpaperFindings(analysis.items,doc.figures,doc.exclusions,doc.assignments),[analysis,doc.figures,doc.exclusions,doc.assignments])
  const statuses = ['To review','On hold','Escalated','Excluded','Verified']
  const statusOf = (candidate:Finding) => findingStatus(candidate,doc.figures,doc.exclusions)
  const pending = findings.filter(candidate=>statusOf(candidate)==='To review')
  const unresolved = findings.filter(candidate=>['On hold','Escalated'].includes(statusOf(candidate))).length
  const visible = findings.filter(candidate=>{
    const id = findingKey(candidate)
    const assigned = doc.assignments?.[id]
    return (queue==='All' || queue===statusOf(candidate)) &&
      (!assignee || (assignee==='unassigned' ? !assigned?.assignee : 'name:'+assigned?.assignee===assignee)) &&
      (!priority || (assigned?.priority ?? 'Normal')===priority) &&
      (!failure || failure === doc.exclusions?.[id]?.code ||
        failure === 'Arithmetic Variance' && rules.some(rule=>includes(rule,candidate) && variance(rule,doc.figures)?.failed) ||
        failure === 'Ambiguous period' && !candidate.period ||
        failure === 'Low OCR confidence' && (candidate.source.ocr || doc.ocrPages?.includes(candidate.source.page)) &&
          (candidate.source.confidence ?? 0) < 90)
  })
  const hits = query.trim() ? doc.lines.filter(value=>value.text.toLowerCase().includes(query.trim().toLowerCase())) : []
  const scopedRules = rules.filter(rule => finding && includes(rule,finding))
  const flagged = new Set(rules.filter(rule=>variance(rule,doc.figures)?.failed)
    .flatMap(rule=>[rule.total,...rule.operands.map(item=>item.finding)].map(findingKey)))

  useEffect(()=>{
    const objectUrl = URL.createObjectURL(initial.file)
    setUrl(objectUrl)
    return ()=>URL.revokeObjectURL(objectUrl)
  },[initial.file])

  const formLinked = !!hover && hover===anchor
  useEffect(()=>{
    const grid = desk.current
    if (!grid || !formLinked) return
    let frame = 0
    function draw() {
      const mark = grid?.querySelector('[data-active-anchor]')
      const field = grid?.querySelector('[data-source-field]')
      const paper = grid?.querySelector('.paper-container')
      const panel = grid?.querySelector('.review-content')
      if (!mark || !field || !paper || !panel || !grid) return setConnector('')
      const b = mark.getBoundingClientRect(), f = field.getBoundingClientRect(), p = paper.getBoundingClientRect()
      const g = grid.getBoundingClientRect(), v = panel.getBoundingClientRect()
      const y = b.top + b.height/2, end = f.top + f.height/2
      if (!b.width || !f.width || y<p.top || y>p.bottom || end<v.top || end>v.bottom || f.left<p.right) return setConnector('')
      const x1 = Math.min(b.right,p.right)-g.left, y1 = y-g.top, x2 = f.left-g.left, y2 = end-g.top
      const mid = (x1+x2)/2
      setConnector(`M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`)
    }
    const update = () => {cancelAnimationFrame(frame); frame=requestAnimationFrame(draw)}
    const resize = new ResizeObserver(update)
    resize.observe(grid)
    grid.addEventListener('scroll',update,true)
    update()
    return ()=>{cancelAnimationFrame(frame);resize.disconnect();grid.removeEventListener('scroll',update,true)}
  },[formLinked,page,tab,pane,anchor])

  function open(capture: Capture) {
    setSelection(capture.finding || capture.figure ? capture : {...capture,manualId:crypto.randomUUID()})
    setPage(capture.line.page)
    setTab('Verify')
    setPane('review')
    setDisposition(undefined)
    setHover(undefined)
    setError('')
  }
  function openFigure(saved:Figure) {open({line:saved.source,figure:saved,finding:saved.original})}

  async function commit(update:(previous:RecordFile,saved:string)=>{record:RecordFile; event:Omit<AuditEvent,'id'|'saved'>}) {
    if (working) return
    setBusy(true)
    setError('')
    try {
      const updated = await change(doc.id,previous=>{
        if (!previous) throw Error()
        const saved = new Date().toISOString()
        const {record,event} = update(previous,saved)
        return {...record,history:[...(previous.history ?? []),{...event,id:crypto.randomUUID(),saved}]}
      })
      if (!updated) throw Error()
      setDoc(updated)
      const last = updated.history?.at(-1)
      if (last?.reviewer) setCurrentReviewer(last.reviewer)
      onChange()
      return updated
    } catch {
      setError('This change could not be saved. Reopen the workpaper and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function save(next:Figure, advance:boolean, remove=false) {
    const reviewer = next.reviewer?.trim() || currentReviewer
    if (!reviewer) return setError('Enter your reviewer ID.')
    const updated = await commit((previous,saved)=>{
      const before = previous.figures.find(value=>value.id===next.id)
      if (figure && before?.saved!==figure.saved) throw Error()
      if (!figure && finding && (reviewedFinding(finding,previous.figures) || previous.exclusions?.[findingKey(finding)]?.reason)) throw Error()
      const after = remove ? undefined : {...next,reviewer,saved}
      return {
        record:{...previous,figures:[...previous.figures.filter(value=>value.id!==next.id),...(after ? [after] : [])]},
        event:{action:remove?'Delete figure':before?'Edit figure':'Verify figure',reviewer,reason:remove?'Removed from register':next.changeReason ?? '',original:next.original,before,after},
      }
    })
    setDeleting(undefined)
    if (!updated) return
    setAnnouncement(remove ? 'Figure deleted.' : 'Figure saved to the register.')
    const position = pending.findIndex(candidate=>findingKey(candidate)===key)
    const ordered = position<0 ? pending : [...pending.slice(position+1),...pending.slice(0,position)]
    const following = advance && ordered.find(candidate=>findingStatus(candidate,updated.figures,updated.exclusions)==='To review')
    if (following) open(captureFinding(following,updated.figures))
    else {setSelection(undefined);setTab('Queue')}
  }

  async function setDecision(reason:string|null, reviewer:string, code?:string, status?:Disposition) {
    if (!key || !finding) return
    if (!reviewer) return setError('Enter your reviewer ID.')
    const updated = await commit((previous,saved)=>{
      const before = previous.exclusions?.[key]
      if (before?.saved!==decision?.saved || reviewedFinding(finding,previous.figures)) throw Error()
      const after = {finding,reason,code,status,reviewer,saved}
      return {record:{...previous,exclusions:{...previous.exclusions,[key]:after}},
        event:{action:status ?? 'Return to review',reviewer,reason:reason ?? 'Returned to queue',original:finding,before,after}}
    })
    if (!updated) return
    setAnnouncement(status ? 'Finding updated to ' + status.toLowerCase() + '.' : 'Finding returned to the review queue.')
    setDisposition(undefined)
    if (status) {setQueue(status);setSelection(undefined);setTab('Queue')}
    else setQueue('To review')
  }

  async function assign(value:string, priority:Priority, reviewer:string) {
    if (!key || !finding) return
    if (!reviewer) return setError('Enter your reviewer ID.')
    const updated = await commit((previous,saved)=>{
      const before = previous.assignments?.[key]
      if (before?.saved!==assignment?.saved) throw Error()
      const after = {assignee:value,priority,saved,finding}
      return {record:{...previous,assignments:{...previous.assignments,[key]:after}},
        event:{action:'Update assignment',reason:'',reviewer,original:finding,before,after}}
    })
    if (updated) setAnnouncement('Assignment saved.')
  }

  function hostedEndpoint() {
    if (settings.ocr!=='hosted') return undefined
    if (!settings.endpoint) throw Error('Set an HTTPS OCR endpoint in Agent MCP & Skill.')
    return settings.endpoint
  }

  async function recognize(box?:Line['box']) {
    if (working) return
    const indexed = box && indexedRegion(doc.lines,page,box)
    if (indexed) return applyRegion(indexed)
    setScanning(true)
    setError('')
    try {
      const endpoint = hostedEndpoint()
      if (box) {
        const matches = await readRegion(doc,page,box,endpoint)
        if (!matches.length) throw Error('No readable text was found in the selected area.')
        const confidences = matches.flatMap(match => match.confidence === undefined ? [] : [match.confidence])
        applyRegion({page,box,text:matches.map(match=>match.text).join(' '),ocr:true,
          confidence:confidences.length===matches.length ? Math.min(...confidences) : undefined})
      } else {
        const updated = await scanPage(doc,page,currentReviewer,endpoint)
        setDoc(updated)
        onChange()
        setAnnouncement('Updated searchable text on page ' + page + '.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not recognize this page.')
    } finally {
      setScanning(false)
    }
  }

  function applyRegion(source:Line) {
    const current = tab==='Verify' && selection && !decision?.reason ? selection : undefined
    if (current) {
      setSelection({...current,line:{...source,column:current.line.column}})
      setPane('review')
    } else open({line:source})
    setAnnouncement('Selected source text captured.')
  }

  async function exportFile(format:'Excel'|'Folio', figures?:Figure[]) {
    try {
      if (format==='Excel') (await import('./workbook')).writeWorkbook(doc,figures)
      else await (await import('./backup')).backup(doc)
      setAnnouncement(format+' export started.')
    } catch {
      setError('Export failed. Try again.')
    }
  }

  const annotations:Annotation[] = []
  const mapped = new Map<string,Annotation>()
  for (const candidate of findings.filter(candidate=>candidate.source.page===page)) {
    const id = findingKey(candidate)
    const verified = reviewedFinding(candidate,doc.figures)
    const status = statusOf(candidate)
    if (verified || !heatmap && id!==anchor || status==='Excluded' && id!==anchor) continue
    const source = id===anchor && line?.page===page ? line : candidate.source
    const fromOCR = source.ocr || doc.ocrPages?.includes(source.page)
    const high = candidate.period && candidate.unit && !candidate.review_flags?.length && !flagged.has(id) &&
      (fromOCR ? (source.confidence ?? 0)>=90 : !!source.words?.length || 'cell_box' in source && !!source.cell_box) &&
      status==='To review'
    mapped.set(id,{id,box:source.box,label:`${candidate.label} · ${candidate.amount} · ${candidate.period || 'Unknown period'} · ${high ? fromOCR ? 'High OCR confidence' : 'Direct PDF evidence' : 'Review required'}`,
      tone:high?'confident':'review',activate:()=>open(captureFinding(candidate,doc.figures))})
  }
  for (const saved of doc.figures.filter(saved=>saved.source.page===page)) {
    const id = 'figure-'+saved.id
    if (!heatmap && id!==anchor) continue
    mapped.set(id,{id,box:id===anchor && line?.page===page ? line.box : saved.source.box,label:`${saved.label} · ${saved.amount} · Verified`,tone:'verified',activate:()=>openFigure(saved)})
  }
  const bounds = new Map<string,Annotation>()
  for (const annotation of mapped.values()) {
    const [x,y,x2,y2] = annotation.box
    if (x2<=x || y2<=y) continue
    const location = annotation.box.join(',')
    const prior = bounds.get(location)
    if (!prior || annotation.id===anchor || prior.id!==anchor && annotation.tone==='verified') bounds.set(location,annotation)
  }
  annotations.push(...bounds.values())
  const failureReasons = [...new Set([...settings.reasons,...Object.values(doc.exclusions ?? {}).flatMap(entry=>entry.code ? [entry.code] : []),
    'Arithmetic Variance','Ambiguous period','Low OCR confidence'])]
  const reviewer = currentReviewer
  const queuePosition = key && pending.findIndex(candidate=>findingKey(candidate)===key)

  return <div className="reader">
    <header className="reader-heading">
      <div className="reader-title"><Button label="Back to documents" variant="ghost" icon={<ArrowLeft size={17}/>} isIconOnly onClick={back}/>
        <FileText size={19}/><div><h1 title={doc.name}>{doc.name}</h1><p>{doc.pages} pages · {pending.length} to review · {doc.figures.length} verified{unresolved ? ` · ${unresolved} unresolved` : ''}</p></div>
        {doc.sample && <Badge label="Sample"/>}
      </div>
      <div className="reader-tools">
        <Button label={heatmap ? 'Heatmap on' : 'Heatmap off'} icon={<Crosshair size={15}/>} size="sm" aria-pressed={heatmap} onClick={()=>setHeatmap(!heatmap)}/>
        <Button label={scanning ? 'Reading…' : 'OCR retry'} tooltip={settings.ocr==='hosted' ? 'Send this page image to your configured OCR endpoint' : 'Run local OCR on this page'} size="sm" icon={<ScanLine size={15}/>} isLoading={scanning} isDisabled={busy} onClick={()=>void recognize()}/>
      </div>
    </header>
    <div className="reader-mobile"><SegmentedControl label="Visible workspace pane" value={pane} onChange={setPane}>
      <SegmentedControlItem value="review" label="Review"/><SegmentedControlItem value="pdf" label="Source PDF"/>
    </SegmentedControl></div>
    <p className="sr-only" role="status">{announcement}</p>
    {error && <div role="alert" className="notice error">{error}</div>}
    <div className="desk" data-pane={pane} ref={desk}>
      <div className="document-pane">{url && <Document url={url} filename={doc.name} pages={doc.pages} page={page} onPage={setPage}
        onRegion={box=>void recognize(box)} annotations={annotations} selected={line?.page===page ? anchor : undefined} linked={formLinked}
        onLink={id=>{setHover(id); if (!id) setConnector('')}}
        source={line && {page:line.page,quote:line.text,box:line.box,value:'',basis:''}}/>}</div>
      <Card padding={0} className="review-pane" role="complementary" aria-label="Review workspace">
        <div className="review-tabs">
          <TabList role="tablist" aria-label="Review views" value={tab} onChange={value=>{setTab(value as TabName);setHover(undefined)}} hasDivider>
            {(['Verify','Queue','Search'] as const).filter(name=>name!=='Verify' || selection).map(name=><Tab key={name} id={'review-tab-'+name} value={name} panelId={'review-panel-'+name}
              label={name==='Queue' ? `Queue (${pending.length+unresolved})` : name}/>)}
          </TabList>
        </div>
        <div className="review-content" id={'review-panel-'+tab} role="tabpanel" aria-labelledby={'review-tab-'+tab}>
          {tab==='Queue' && <>
            <div className="review-heading"><div><h2>Review queue</h2><p>{visible.length} of {findings.length} findings</p></div>
              <Button label="Add figure" size="sm" onClick={()=>open({line:{page,text:'',box:[0,0,0,0]}})} isDisabled={working}/></div>
            <div className="queue-filters">
              <select aria-label="Queue status" value={queue} onChange={event=>setQueue(event.target.value)}>
                {['All',...statuses].map(status=><option key={status} value={status}>{status} ({status==='All' ? findings.length : findings.filter(candidate=>statusOf(candidate)===status).length})</option>)}
              </select>
              <select aria-label="Filter by assignee" value={assignee} onChange={event=>setAssignee(event.target.value)}>
                <option value="">All assignees</option><option value="unassigned">Unassigned</option>
                {[...new Set(Object.values(doc.assignments ?? {}).map(value=>value.assignee).filter(Boolean))].sort().map(name=><option key={name} value={'name:'+name}>{name}</option>)}</select>
              <select aria-label="Filter by priority" value={priority} onChange={event=>setPriority(event.target.value)}>
                <option value="">All priorities</option>{priorities.map(value=><option key={value}>{value}</option>)}</select>
              <select aria-label="Filter by failure reason" value={failure} onChange={event=>setFailure(event.target.value)}>
                <option value="">All failure reasons</option>{failureReasons.map(reason=><option key={reason}>{reason}</option>)}</select>
            </div>
            {!!rules.length && <details className="checks"><summary>Document reconciliation checks ({rules.length})</summary>
              {rules.map((rule,index)=>{
                const result = variance(rule,doc.figures)
                return <p key={index}>{rule.name} · {rule.total.period || `Page ${rule.total.source.page}`} · {result ? result.failed ? `Variance ${result.difference} ${rule.total.unit}` : 'Reconciles' : 'Review units and periods'}</p>
              })}</details>}
            <div className="findings">{visible.map(candidate=>{
              const id = findingKey(candidate), status = statusOf(candidate), assigned = doc.assignments?.[id]
              return <button key={id} onClick={()=>open(captureFinding(candidate,doc.figures))}>
                <span><strong>{candidate.label}</strong><small>{[candidate.period,`p. ${candidate.source.page}`,assigned?.assignee,assigned?.priority,candidate.source.ocr?'OCR':''].filter(Boolean).join(' · ')}</small>
                  {status!=='To review' && <span className={`status-pill ${status==='Verified' ? 'verified' : 'review'}`}>{status}</span>}</span>
                <span className="finding-value"><b>{candidate.amount}</b><small>{candidate.unit}</small></span><ChevronRight size={15}/>
              </button>
            })}</div>
            {!visible.length && <div className="review-empty"><ClipboardCheck size={22}/><strong>{findings.length ? 'No findings match these filters' : 'No proposed figures'}</strong>
              <p>{findings.length ? 'Change the status or queue filters.' : 'Search source text, run OCR, or select an area on the PDF.'}</p></div>}
          </>}
          {tab==='Search' && <>
            <div className="review-heading"><div><h2>Search source text</h2><p>{query.trim() ? hits.length+' matching lines' : 'Search PDF text and indexed scans.'}</p></div></div>
            <label className="search-source"><Search size={15}/><input aria-label="Search document" placeholder="Find a phrase or amount…" value={query} onChange={event=>{setQuery(event.target.value);setLimit(40)}}/></label>
            <div className="results">{hits.slice(0,limit).map((hit,index)=><button key={index} onClick={()=>open({line:hit})}>
              <small>Page {hit.page}</small><span>{hit.text}</span><ChevronRight size={15}/></button>)}</div>
            {hits.length>limit && <Button label="Show more matches" onClick={()=>setLimit(limit+50)}/>}
          </>}
          {tab==='Verify' && line && <>
            <div className="review-heading capture-heading"><div>
              <h2>{figure ? 'Edit verified figure' : decision?.reason ? decision.status ?? 'Excluded finding' : finding ? 'Verify finding' : 'Capture figure'}</h2>
              <p>{typeof queuePosition==='number' && queuePosition>=0 ? `Item ${queuePosition+1} of ${pending.length} · ` : ''}Page {line.page}</p>
            </div><Button className="mobile-source" label="View source" icon={<ArrowUpRight size={14}/>} onClick={()=>{setPage(line.page);setPane('pdf')}}/></div>
            {decision?.reason && !figure ? <form className="entry" onSubmit={event=>{
              event.preventDefault();void setDecision(null,String(new FormData(event.currentTarget).get('reviewer') ?? '').trim())
            }}>
              <div className="source-quote"><small>Source evidence</small><p>{line.text}</p></div>
              <div className="source-quote"><small>{decision.code ?? 'Decision reason'}</small><p>{decision.reason}</p><small>{decision.reviewer}</small></div>
              <label>Reviewer ID<input name="reviewer" required defaultValue={reviewer} maxLength={120}/></label>
              <Button type="submit" label="Return to review queue" variant="primary" isLoading={busy}/>
            </form> : disposition ? <form className="entry" onSubmit={event=>{
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const code = String(data.get('code') ?? '')
              const note = String(data.get('reason') ?? '').trim()
              void setDecision(note || code,String(data.get('reviewer') ?? '').trim(),code,disposition)
            }}>
              <strong>{disposition==='On hold' ? 'Place on hold' : disposition==='Excluded' ? 'Exclude finding' : 'Escalate finding'}</strong>
              <label>Reason code<select name="code" aria-label="Reason code" required defaultValue=""><option value="" disabled>Select a reason</option>
                {(settings.reasons.length ? settings.reasons : defaultReasons).map(reason=><option key={reason}>{reason}</option>)}</select></label>
              <label>Details<textarea name="reason" maxLength={1000} placeholder="Add context for the next reviewer"/></label>
              <label>Reviewer ID<input name="reviewer" required defaultValue={reviewer} maxLength={120}/></label>
              <div className="form-actions"><Button label="Cancel" onClick={()=>setDisposition(undefined)} isDisabled={working}/>
                <Button type="submit" label="Save decision" variant="primary" isLoading={busy} isDisabled={scanning}/></div>
            </form> : <CaptureForm key={anchor} line={line} figure={figure} finding={finding}
              reviewer={reviewer} working={working} busy={busy} scanning={scanning} hasNext={!!finding && !figure && pending.length>1}
              rules={scopedRules} figures={doc.figures} assignment={assignment} selected={formLinked}
              onLink={value=>{setHover(value ? anchor : undefined);if (!value) setConnector('')}}
              onSave={save} onAssign={assign} onDecision={setDisposition} onDelete={id=>id ? setDeleting(id) : setError('Enter your reviewer ID.')}
              periods={analysis.items.flatMap(value=>value.period ? [value.period] : [])}
              units={analysis.items.flatMap(value=>value.unit ? [value.unit] : [])}
              onError={setError} needsOcr={doc.ocrPages?.includes(line.page)}/>}
          </>}
        </div>
      </Card>
      {formLinked && connector && <svg className="anchor-line" aria-hidden="true"><path d={connector}/></svg>}
    </div>
    <WorkpaperRegister doc={doc} onOpen={openFigure} onExport={(format,figures)=>void exportFile(format,figures)}
      onCsv={figures=>downloadRegister(figures.map(figure=>({figure,document:doc.name})),doc.name.replace(/\.pdf$/i,'')+'-register.csv')}/>
    <AlertDialog isOpen={deleting!==undefined} onOpenChange={value=>{if (!busy && !value) setDeleting(undefined)}} title="Delete verified figure?"
      description="The figure will be removed from the register. Its values and citation will be recorded in Activity history."
      actionLabel="Delete figure" isActionLoading={busy} onAction={()=>figure && deleting && save({...figure,reviewer:deleting},false,true)}/>
  </div>
}

function includes(rule:Rule, finding:Finding) {
  const key = findingKey(finding)
  return [rule.total,...rule.operands.map(item=>item.finding)].some(candidate=>findingKey(candidate)===key)
}

function variance(rule:Rule, figures:Figure[], draft?:{finding:Finding; amount:string; unit:string; period:string}) {
  const observed = (finding:Finding) => draft && findingKey(finding)===findingKey(draft.finding) ? draft : reviewedFinding(finding,figures) ?? finding
  const total = observed(rule.total)
  const terms = rule.operands.map(item=>({value:observed(item.finding),sign:item.sign}))
  const values = [total,...terms.map(item=>item.value)]
  if (values.some(value=>value.unit!==rule.total.unit || value.period!==rule.total.period || !/^-?\d+(\.\d+)?$/.test(value.amount))) return
  const precision = Math.max(...values.map(value=>value.amount.split('.')[1]?.length ?? 0))
  const integer = (amount:string) => {
    const [whole,fraction=''] = amount.replace(/^-/,'').split('.')
    return BigInt((amount.startsWith('-') ? '-' : '')+whole+fraction.padEnd(precision,'0'))
  }
  const difference = integer(total.amount)-terms.reduce((sum,item)=>sum+integer(item.value.amount)*BigInt(item.sign),0n)
  const absolute = (difference<0n ? -difference : difference).toString().padStart(precision+1,'0')
  const formatted = precision ? absolute.slice(0,-precision)+'.'+absolute.slice(-precision) : absolute
  return {failed:difference!==0n,difference:(difference<0n?'-':'')+formatted}
}

function CaptureForm({line,figure,finding,reviewer,working,busy,scanning,hasNext,rules,figures,assignment,selected,onLink,
  onSave,onAssign,onDecision,onDelete,periods,units,onError,needsOcr}: {
  line:Line; figure?:Figure; finding?:Finding; reviewer:string; working:boolean; busy:boolean; scanning:boolean; hasNext:boolean
  rules:Rule[]; figures:Figure[]; assignment?:Assignment
  selected:boolean; onLink:(value:boolean)=>void; onSave:(figure:Figure,advance:boolean)=>void
  onAssign:(assignee:string, priority:Priority, reviewer:string)=>void; onDecision:(value:Disposition)=>void; onDelete:(reviewer:string)=>void
  periods:string[]; units:string[]; onError:(message:string)=>void; needsOcr?:boolean
}) {
  const [amount,setAmount] = useState(figure?.amount ?? finding?.amount ?? '')
  const [unit,setUnit] = useState(figure?.unit ?? finding?.unit ?? '')
  const [period,setPeriod] = useState(figure?.period ?? finding?.period ?? '')
  const [label,setLabel] = useState(figure?.label ?? finding?.label ?? line.text.split(/(?:[0-9]|[$£€])/)[0].replace(/[^a-zA-Z)]+$/,'').trim())
  const [quote,setQuote] = useState(line.text)
  const [note,setNote] = useState(figure?.note ?? '')
  useEffect(()=>{setQuote(line.text)},[line])
  const baseline = figure ?? finding
  const edited = !!baseline && (label.trim()!==baseline.label || amount.trim()!==baseline.amount || unit.trim()!==baseline.unit ||
    period.trim()!==baseline.period || quote.trim()!==baseline.source.text || line.page!==baseline.source.page ||
    line.box.some((value,index)=>value!==baseline.source.box[index]) || !!figure && note.trim()!==figure.note)
  const original = figure?.original ?? finding
  const weak = !!finding?.review_flags?.length || !!finding && (!finding.period || !finding.unit) ||
    (line.ocr || needsOcr) && (line.confidence ?? 0)<90
  const suggestedPeriods = [...new Set([...periods,...(line.text.match(/\bFY\s*(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b/gi) ?? [])])]
  const suggestedUnits = [...new Set([...units,...(line.text.match(/\b(?:USD|EUR|GBP|CAD|AUD|TRY|NGN)(?:\s+(?:million|billion|thousand)s?)?\b|%/gi) ?? [])])]
  return <form className="entry" onSubmit={event=>{
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const read = (name:string) => String(form.get(name) ?? '').trim()
    const reason = read('change-reason')
    if (!label.trim() || !quote.trim()) return onError('Complete the metric and source evidence.')
    if (edited && !reason) return onError('Enter the reason for changing the figure.')
    onSave({
      id:figure?.id ?? crypto.randomUUID(),label:label.trim(),amount:amount.trim(),unit:unit.trim(),period:period.trim(),note:note.trim(),
      source:{...line,text:quote.trim()},saved:new Date().toISOString(),reviewer:read('reviewer'),original,
      changeReason:reason,findingKey:figure?.findingKey ?? (finding && findingKey(finding)),
    }, (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='next')
  }}>
    <div className="finding-meta">
      <span className={`status-pill ${weak ? 'review' : figure || line.confidence!==undefined ? 'verified' : 'neutral'}`}>
        {line.confidence!==undefined ? `OCR confidence ${Math.round(line.confidence)}%` : line.ocr || needsOcr ? 'OCR confidence unavailable' : 'PDF text layer'}
      </span>
      {weak && <span className="status-pill review">Review required</span>}
      {finding?.review_flags?.map(flag=><span key={flag} className="meta-flag">{flag.replaceAll('_',' ')}</span>)}
    </div>
    <label>Metric<input name="label" value={label} maxLength={500} onChange={event=>setLabel(event.target.value)} required/></label>
    <div className="pair">
      <label>Value<input name="amount" value={amount} onChange={event=>setAmount(event.target.value)} required maxLength={80}
        pattern="-?[0-9]+([.][0-9]+)?" inputMode="decimal" list="source-amounts" placeholder="Numeric value"/></label>
      <label>Unit<input name="unit" value={unit} onChange={event=>setUnit(event.target.value)} maxLength={120} list="source-units" placeholder="Select or enter"/></label>
    </div>
    {original && <div className="extracted"><span>Extracted <b>{original.amount}</b> {original.unit}</span>{original.normalized_amount && original.normalized_amount!==original.amount && <span>Normalized <b>{original.normalized_amount}</b></span>}</div>}
    <label>Reporting period<input name="period" list="source-periods" value={period} onChange={event=>setPeriod(event.target.value)} maxLength={120} placeholder="Select or enter"/></label>
    <datalist id="source-periods">{suggestedPeriods.map(value=><option key={value} value={value}/>)}</datalist>
    <datalist id="source-units">{suggestedUnits.map(value=><option key={value} value={value}/>)}</datalist>
    <datalist id="source-amounts">{[...new Set((line.text.match(/(?:\(\d[\d,]*(?:\.\d+)?\)|-?\d[\d,]*(?:\.\d+)?)/g) ?? [])
      .map(value=>value.replaceAll(',','').replace(/^\((.*)\)$/,'-$1')))].slice(0,24).map(value=><option key={value} value={value}/>)}</datalist>
    <label data-source-field className={selected ? 'linked-field' : undefined} onMouseEnter={()=>onLink(true)} onMouseLeave={()=>onLink(false)}
      onFocus={()=>onLink(true)} onBlur={()=>onLink(false)}>
      Source citation · p. {line.page}<textarea name="quote" required value={quote} maxLength={16000} onChange={event=>setQuote(event.target.value)}
        placeholder="Select an area on the PDF or enter source text"/>
    </label>
    {rules.map((rule,index)=>{
      const result = variance(rule,figures,finding && {finding,amount,unit,period})
      return <div className={`math-check ${result && !result.failed ? 'verified' : 'review'}`} key={index}>
        {result && !result.failed ? <Check size={15}/> : <ShieldAlert size={15}/>}
        <span><strong>{rule.name}</strong> · {result ? result.failed ? `Variance ${result.difference} ${rule.total.unit}` : 'Reconciles' : 'Check units or periods'}</span>
      </div>
    })}
    <label>Reviewer ID<input name="reviewer" required defaultValue={reviewer} maxLength={120} placeholder="Name or team ID"/></label>
    {edited && <label>Change reason<input name="change-reason" required maxLength={500} placeholder="e.g. Adjusted scale"/></label>}
    <label>Notes<textarea name="note" value={note} maxLength={4000} onChange={event=>setNote(event.target.value)} placeholder="Optional"/></label>
    {finding && <details className="assignment">
      <summary>{assignment ? `Assignment · ${assignment.assignee || 'Unassigned'} · ${assignment.priority}` : 'Assignment and priority'}</summary>
      <div className="pair">
        <label>Assignee<input name="assignee" defaultValue={assignment?.assignee} maxLength={120} placeholder="Unassigned"/></label>
        <label>Priority<select name="priority" aria-label="Priority" defaultValue={assignment?.priority ?? 'Normal'}>{priorities.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <Button size="sm" label="Save assignment" isDisabled={working} onClick={event=>{
        const form = (event.currentTarget as HTMLButtonElement).form
        if (!form) return
        const data = new FormData(form)
        onAssign(String(data.get('assignee') ?? '').trim(),String(data.get('priority')) as Priority,String(data.get('reviewer') ?? '').trim())
      }}/>
    </details>}
    <div className="form-actions">
      <Button type="submit" name="action" value={hasNext ? 'next' : 'save'} label={figure ? 'Save changes' : hasNext ? 'Save & next' : 'Save figure'}
        variant="primary" className="save-action" icon={<Check size={16}/>} isLoading={busy} isDisabled={scanning}/>
      <div className="secondary-actions">
        {hasNext && <Button type="submit" size="sm" label="Save only" isDisabled={working}/>}
        {finding && !figure && <><Button size="sm" label="Exclude" onClick={()=>onDecision('Excluded')} isDisabled={working}/>
          <Button size="sm" label="Hold" onClick={()=>onDecision('On hold')} isDisabled={working}/>
          <Button size="sm" label="Escalate" onClick={()=>onDecision('Escalated')} isDisabled={working}/></>}
        {figure && <Button size="sm" label="Delete figure" onClick={event=>{
          const form = (event.currentTarget as HTMLButtonElement).form
          if (form) onDelete(String(new FormData(form).get('reviewer') ?? '').trim())
        }} isDisabled={working}/>}
      </div>
    </div>
  </form>
}
