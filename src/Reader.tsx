import {useEffect, useMemo, useRef, useState} from 'react'
import {AlertDialog} from '@astryxdesign/core/AlertDialog'
import {Card} from '@astryxdesign/core/Card'
import {Button} from '@astryxdesign/core/Button'
import {Badge} from '@astryxdesign/core/Badge'
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl'
import {Tab, TabList} from '@astryxdesign/core/TabList'
import {ArrowLeft, Check, ChevronRight, ClipboardCheck, FileText, ScanLine, Search, ShieldAlert} from 'lucide-react'
import {analyzeLines, type Finding} from './findings'
import {Document, type Annotation} from './Document'
import {change, downloadRegister, indexedRegion, readRegion, scanPage, type Figure, type Line, type RecordFile} from './register'
import {defaultReasons, findingKey, findingStatus, priorities, queueCounts, statuses, reviewedFinding, workpaperFindings, type Assignment, type AuditEvent, type Disposition, type Priority} from './review'
import type {Preferences} from './preferences'
import {formattedAmount, scaleName, sourceScale} from './amount'
import {risk} from './triage'
import type {AgentDraft} from './agentDraft'
import {QueueStatus, StatusPill, unresolvedCount} from './QueueStatus'
import {WorkpaperRegister} from './WorkpaperRegister'
import {TieOutSplit} from './TieOutSplit'
import {vlmEndpoint} from './vlm'
import {SealDialog} from './SealDialog'
import {tieOuts, involves, type TieOut} from './tieout'

type TabName = 'Verify' | 'Queue' | 'Search'
type Capture = {line:Line; figure?:Figure; finding?:Finding; manualId?:string}
import {includes,variance,reconciliation,type Rule} from './reconciliation'
const captureFinding = (finding:Finding, figures:Figure[]): Capture => {
  const figure = reviewedFinding(finding,figures)
  return {finding,figure,line:figure?.source ?? finding.source}
}
const matchesQueue = (queue:string, status:string) => queue==='All' || queue===status ||
  queue==='Unresolved' && ['Pending','On Hold','Escalated'].includes(status)
function nextFinding(doc:RecordFile) {
  return workpaperFindings(analyzeLines(doc.lines).items, doc.figures, doc.exclusions, doc.assignments)
    .find(finding => findingStatus(finding, doc.figures, doc.exclusions) === 'Pending')
}

export function Reader({initial, initialFigure, back, settings, onSettings, onChange}: {
  initial:RecordFile; initialFigure?:string; back:()=>void; settings:Preferences; onSettings:(settings:Preferences)=>void; onChange:(doc:RecordFile)=>void
}) {
  const doc = initial
  const [selection,setSelection] = useState<Capture | undefined>(() => {
    const figure = initial.figures.find(figure => figure.id === initialFigure)
    if (figure) return {figure,line:figure.source,finding:figure.original}
    const first = nextFinding(initial)
    return first && captureFinding(first,initial.figures)
  })
  const [page,setPage] = useState(selection?.line.page ?? 1)
  const [tab,setTab] = useState<TabName>(selection ? 'Verify' : 'Queue')
  const [queue,setQueue] = useState(initialFigure ? 'Verified' : 'Unresolved')
  const currentReviewer = settings.reviewer.trim()
  const [session,setSession] = useState<Finding[]>(()=>workpaperFindings(analyzeLines(initial.lines).items,initial.figures,initial.exclusions,initial.assignments)
    .filter(candidate=>matchesQueue(initialFigure ? 'Verified' : 'Unresolved',findingStatus(candidate,initial.figures,initial.exclusions))))
  const [scope,setScope] = useState(initialFigure ? 'Verified' : 'Unresolved')
  const [formula,setFormula] = useState<Rule>()
  const [confirmScan,setConfirmScan] = useState(false)
  const [assignee,setAssignee] = useState('')
  const [priority,setPriority] = useState('')
  const [triage,setTriage] = useState('')
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
  const [identify,setIdentify] = useState<{resume:(reviewer:string)=>void}>()
  const [split,setSplit] = useState<TieOut>()
  const [sealing,setSealing] = useState(false)
  const desk = useRef<HTMLDivElement>(null)
  const working = busy || scanning
  const {line,figure,finding} = selection ?? {}
  const key = finding && findingKey(finding)
  const anchor = figure ? 'figure-' + figure.id : key ?? selection?.manualId ?? 'capture'
  const decision = key ? doc.exclusions?.[key] : undefined
  const assignment = key ? doc.assignments?.[key] : undefined
  const draft = key ? doc.drafts?.[key] : undefined

  const analysis = useMemo(()=>analyzeLines(doc.lines),[doc.lines])
  const rules = useMemo(()=>reconciliation(analysis),[analysis])
  const findings = useMemo(()=>workpaperFindings(analysis.items,doc.figures,doc.exclusions,doc.assignments),[analysis,doc.figures,doc.exclusions,doc.assignments])
  const statusOf = (candidate:Finding) => findingStatus(candidate,doc.figures,doc.exclusions)
  const ties = useMemo(()=>tieOuts(findings,doc.figures,doc.exclusions),[findings,doc.figures,doc.exclusions])
  const counts = queueCounts(findings,doc.figures,doc.exclusions)
  const unresolved = unresolvedCount(counts)
  const queueScope = [queue==='All' ? 'All findings' : queue,...[assignee,priority,triage,failure].filter(Boolean).map(()=>'+')].join(' ').replace(/( \+)+$/,' + refined')
  const visible = findings.filter(candidate=>{
    const id = findingKey(candidate)
    const assigned = doc.assignments?.[id]
    return matchesQueue(queue,statusOf(candidate)) &&
      (!assignee || (assignee==='unassigned' ? !assigned?.assignee : 'name:'+assigned?.assignee===assignee)) &&
      (!triage || risk(candidate,rules,doc.figures,settings.triage)===triage) &&
      (!priority || (assigned?.priority ?? 'Normal')===priority) &&
      (!failure || failure === doc.exclusions?.[id]?.code ||
        failure === 'Arithmetic Variance' && rules.some(rule=>includes(rule,candidate) && variance(rule,doc.figures)?.failed) ||
        failure === 'Tie-out variance' && ties.some(tie=>tie.failed && involves(tie,candidate)) ||
        failure === 'Ambiguous period' && !candidate.period ||
        failure === 'Low OCR confidence' && (candidate.source.ocr || doc.ocrPages?.includes(candidate.source.page)) &&
          (candidate.source.confidence ?? 0) < 90)
  })
  const hits = query.trim() ? doc.lines.filter(value=>value.text.toLowerCase().includes(query.trim().toLowerCase())) : []
  const scopedRules = rules.filter(rule => finding && includes(rule,finding))
  const scopedTies = ties.filter(tie => finding && involves(tie,finding))
  const varianceKeys = new Set(ties.filter(tie=>tie.failed).flatMap(tie=>[tie.a,tie.b].map(side=>findingKey(side.finding))))
  const flagged = new Set(rules.filter(rule=>variance(rule,doc.figures)?.failed)
    .flatMap(rule=>[rule.total,...rule.operands.map(item=>item.finding)].map(findingKey)))


  const formLinked = !!hover && hover===anchor
  const seenDrafts = useRef(new Set(Object.values(initial.drafts ?? {}).map(value=>value.id)))
  useEffect(()=>{
    const incoming = Object.values(doc.drafts ?? {}).filter(value=>!seenDrafts.current.has(value.id))
    for (const value of incoming) seenDrafts.current.add(value.id)
    const target = incoming.at(-1) && findings.find(candidate=>findingKey(candidate)===incoming.at(-1)!.findingId)
    if (!target) return
    open(captureFinding(target,doc.figures))
    setHover(findingKey(target))
  },[doc.drafts])
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
  },[formLinked,page,tab,anchor])

  function open(capture: Capture, group?:Finding[], groupScope?:string) {
    if (group) {setSession(group);setScope(groupScope ?? 'Custom')}
    setFormula(undefined)
    setSelection(capture.finding || capture.figure ? capture : {...capture,manualId:crypto.randomUUID()})
    setPage(capture.line.page)
    setTab('Verify')
    setDisposition(undefined)
    setHover(undefined)
    setError('')
    setIdentify(undefined)
    setSplit(current=>current && capture.finding && involves(current,capture.finding) ? current : undefined)
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
      onChange(updated)
      return updated
    } catch {
      setError('This change could not be saved. Reopen the workpaper and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function save(next:Figure, advance:boolean, remove=false, routing?:Pick<Assignment,'assignee'|'priority'>, approved?:AgentDraft) {
    const reviewer = next.reviewer?.trim() || currentReviewer
    if (!reviewer) return setIdentify({resume:name=>void save({...next,reviewer:name},advance,remove,routing,approved)})
    const updated = await commit((previous,saved)=>{
      if (key && previous.drafts?.[key]?.id!==approved?.id) throw Error()
      if (approved && (approved.run!==previous.extractionRuns?.[next.source.page] || approved.baseDecision!==decision?.saved)) throw Error()
      const drafts = {...previous.drafts}
      if (approved && key) delete drafts[key]
      const before = previous.figures.find(value=>value.id===next.id)
      if (figure && before?.saved!==figure.saved) throw Error()
      if (key && (previous.exclusions?.[key]?.saved!==decision?.saved || previous.assignments?.[key]?.saved!==assignment?.saved)) throw Error()
      if (!figure && finding && (reviewedFinding(finding,previous.figures) || decision?.reason && !['On hold','Escalated'].includes(decision.status ?? ''))) throw Error()
      const assignments = {...previous.assignments}
      const exclusions = {...previous.exclusions}
      const priorRouting = key ? assignments[key] : undefined
      if (key && finding && routing && (routing.assignee!==(priorRouting?.assignee ?? '') || routing.priority!==(priorRouting?.priority ?? 'Normal'))) {
        assignments[key] = {...routing,finding,saved}
      }
      if (key && !remove) delete exclusions[key]
      const after = remove ? undefined : {...next,reviewer,saved}
      return {
        record:{...previous,assignments,exclusions,drafts,figures:[...previous.figures.filter(value=>value.id!==next.id),...(after ? [after] : [])]},
        event:{draft:approved,action:remove?'Delete figure':before?'Edit figure':'Verify figure',reviewer,reason:remove?'Removed from register':next.changeReason ?? '',original:next.original,before,after,routing:key && assignments[key]!==priorRouting ? assignments[key] : undefined},
      }
    })
    setDeleting(undefined)
    if (!updated) return
    setAnnouncement(remove ? 'Figure deleted.' : 'Figure saved to the register.')
    const position = session.findIndex(candidate=>findingKey(candidate)===key)
    const ordered = [...session.slice(position+1),...session.slice(0,Math.max(0,position))]
    const following = advance && ordered.find(candidate=>findingStatus(candidate,updated.figures,updated.exclusions)==='Pending')
    if (following) open(captureFinding(following,updated.figures))
    else if (!remove) {
      const saved = updated.figures.find(value=>value.id===next.id)
      if (saved) openFigure(saved)
    } else {setSelection(undefined);setTab('Queue')}
  }

  async function setDecision(reason:string|null, reviewer:string, code?:string, status?:Disposition) {
    if (!key || !finding) return
    if (!reviewer) return setIdentify({resume:name=>void setDecision(reason,name,code,status)})
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
  }

  async function reviewDraft(proposal:AgentDraft,approve:boolean,reviewer=currentReviewer) {
    if (!finding || !key) return
    if (!reviewer) return setIdentify({resume:name=>void reviewDraft(proposal,approve,name)})
    if (approve) {
      if (proposal.run!==finding.source.extraction_run_id || proposal.run!==doc.extractionRuns?.[finding.source.page] ||
        proposal.baseDecision!==decision?.saved) return setError('The source or review status changed. Reject this draft and request a new proposal.')
      const edited:Figure = {id:crypto.randomUUID(),label:proposal.changes.canonicalMetric?.trim() ?? finding.canonical_metric ?? finding.label,
        verbatimLabel:finding.source_label ?? finding.label,amount:proposal.changes.amount ?? finding.amount,unit:proposal.changes.unit ?? finding.unit,period:proposal.changes.period ?? finding.period,
        note:proposal.changes.note ?? '',source:finding.source,saved:new Date().toISOString(),original:finding,findingKey:key,changeReason:proposal.rationale,reviewer}
      await save(edited,false,false,undefined,proposal)
    } else {
      await commit(previous=>{
        if (previous.drafts?.[key]?.id!==proposal.id) throw Error()
        const drafts = {...previous.drafts}
        delete drafts[key]
        return {record:{...previous,drafts},event:{action:'Reject draft',reviewer,
          reason:proposal.rationale,original:finding,draft:proposal}}
      })
    }
  }

  function move(offset:number) {
    const position = session.findIndex(candidate=>findingKey(candidate)===key)
    const next = session[position+offset]
    if (next) open(captureFinding(next,doc.figures))
  }

  function hostedEndpoint() {
    if (settings.ocr==='mistral') return '/api/local/mistral-ocr'
    if (settings.ocr==='vlm') return vlmEndpoint
    if (settings.ocr!=='hosted') return undefined
    if (!settings.endpoint) throw Error('Set an HTTPS OCR endpoint in Agent MCP & Bridge.')
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
        applyRegion({page,box,extraction_run_id:doc.extractionRuns?.[page],text:matches.map(match=>match.text).join(' '),ocr:true,
          confidence:confidences.length===matches.length ? Math.min(...confidences) : undefined})
      } else {
        const updated = await scanPage(doc,page,currentReviewer,endpoint)
        setFormula(undefined)
        if (line?.page===page && !figure) {
          const replacementById = new Map(analyzeLines(updated.lines).items.filter(candidate=>candidate.source.page===page).map(candidate=>[findingKey(candidate),candidate]))
          const fresh = key ? replacementById.get(key) : undefined
          setSession(candidates=>candidates.flatMap(candidate=>{
            if (candidate.source.page!==page) return [candidate]
            const replacement = replacementById.get(findingKey(candidate))
            return replacement ? [replacement] : []
          }))
          if (fresh) open(captureFinding(fresh,updated.figures))
          else {setSelection(undefined);setTab('Queue')}
        }
        onChange(updated)
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
    if (current && !current.line.column) {
      setSelection({...current,line:source})
    } else open({line:source})
    setAnnouncement('Selected source text captured.')
  }

  async function exportFile(format:'Excel'|'Folio', figures?:Figure[]) {
    try {
      if (format==='Excel') (await import('./workbook')).writeWorkbook(doc,figures)
      else await (await import('./backup')).backup(doc,settings.persistReviewer && currentReviewer ? {name:currentReviewer,saved:new Date().toISOString()} : undefined)
      setAnnouncement(format+' export started.')
    } catch {
      setError('Export failed. Try again.')
    }
  }

  const run = doc.extractionRuns?.[page]
  const activeSource = (source:Line) => source.page===page && source.extraction_run_id===run
  const formulaBoxes = formula ? [formula.total,...formula.operands.map(item=>item.finding)]
    .map(item=>reviewedFinding(item,doc.figures)?.source ?? item.source)
    .filter(source=>activeSource(source) && source.box[2]>source.box[0]).map(source=>source.box) : []
  const annotations:Annotation[] = []
  const mapped = new Map<string,Annotation>()
  for (const candidate of findings.filter(candidate=>candidate.source.page===page)) {
    const id = findingKey(candidate)
    const verified = reviewedFinding(candidate,doc.figures)
    const status = statusOf(candidate)
    if (verified || !heatmap && id!==anchor || status==='Excluded' && id!==anchor) continue
    const source = id===anchor && line?.page===page ? line : candidate.source
    if (!activeSource(source)) continue
    const fromOCR = source.ocr || doc.ocrPages?.includes(source.page)
    const high = candidate.period && candidate.unit && !candidate.review_flags?.length && !flagged.has(id) &&
      (fromOCR ? (source.confidence ?? 0)>=90 : !!source.words?.length || 'cell_box' in source && !!source.cell_box) &&
      status==='Pending'
    mapped.set(id,{id,box:source.box,label:`${candidate.label} · ${candidate.amount} · ${candidate.period || 'Unknown period'} · ${high ? fromOCR ? 'High OCR confidence' : 'Direct PDF evidence' : 'Review required'}`,
      tone:varianceKeys.has(id) ? 'variance' : high?'confident':'review',activate:()=>open(captureFinding(candidate,doc.figures))})
  }
  for (const saved of doc.figures.filter(saved=>saved.source.page===page)) {
    const id = 'figure-'+saved.id
    if ((!heatmap && id!==anchor) || !activeSource(id===anchor && line?.page===page ? line : saved.source)) continue
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
    'Arithmetic Variance','Tie-out variance','Ambiguous period','Low OCR confidence'])]
  const reviewer = currentReviewer
  const queuePosition = session.findIndex(candidate=>findingKey(candidate)===key)
  useEffect(()=>{
    function shortcut(event:KeyboardEvent) {
      const target = event.target
      if (event.defaultPrevented || event.repeat || event.isComposing || working || deleting || confirmScan ||
        target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]')) return
      if (event.key==='Enter' && (event.metaKey || event.ctrlKey)) {
        const button = desk.current?.querySelector<HTMLButtonElement>('[data-save-next]')
        if (button) {event.preventDefault();button.click()}
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.code==='Space' && !(target instanceof HTMLElement && target.closest('button,a'))) {
        event.preventDefault()
        setHeatmap(value=>!value)
      } else if (event.key==='[' || event.key===']') {
        event.preventDefault()
        move(event.key===']' ? 1 : -1)
      } else if (tab==='Verify' && !draft && finding && !figure && statusOf(finding)!=='Excluded') {
        if (event.key.toLowerCase()==='e') setDisposition(event.shiftKey ? 'Escalated' : 'Excluded')
        if (event.key.toLowerCase()==='h') setDisposition('On hold')
      }
    }
    window.addEventListener('keydown',shortcut)
    return ()=>window.removeEventListener('keydown',shortcut)
  })


  return <div className="reader">
    <div className="reader-primary"><header className="reader-heading">
      <div className="reader-title"><Button label="Back to documents" variant="ghost" icon={<ArrowLeft size={17}/>} isIconOnly onClick={back}/>
        <FileText size={19}/><div><h1 title={doc.name}>{doc.name}</h1><QueueStatus counts={counts}/></div>
        {doc.sample && <Badge label="Sample"/>}
      </div>
      <div className="reader-tools">
        <label className="reviewer-chip">Reviewer <input aria-label="Reviewer" value={settings.reviewer} maxLength={120}
          placeholder="Set name" onChange={event=>onSettings({...settings,reviewer:event.target.value})}/></label>
        <div className="heatmap"><span>Heatmap</span><SegmentedControl label="Heatmap" value={heatmap?'on':'off'} onChange={value=>setHeatmap(value==='on')}>
          <SegmentedControlItem value="on" label="ON"/><SegmentedControlItem value="off" label="OFF"/>
        </SegmentedControl><kbd>Space</kbd></div>
        <Button label={scanning ? 'Reading…' : 'Re-index OCR'} size="sm" icon={<ScanLine size={15}/>} isLoading={scanning}
          isDisabled={busy} onClick={()=>doc.figures.some(value=>value.source.page===page) ? setConfirmScan(true) : void recognize()}/>
      </div>
    </header>
    <p className="sr-only" role="status">{announcement}</p>
    {error && <div role="alert" className="notice error">{error}</div>}
    <div className="desk" ref={desk}>
      <div className="document-pane">{split ? <TieOutSplit tie={split} file={doc.file} documentKey={doc.id} filename={doc.name} pages={doc.pages}
        onClose={()=>setSplit(undefined)}/> : <Document file={doc.file} documentKey={doc.id} filename={doc.name} pages={doc.pages} page={page} onPage={setPage}
        onRegion={box=>void recognize(box)} annotations={annotations} selected={line?.page===page ? anchor : undefined} linked={formLinked}
        onLink={id=>{setHover(id); if (!id) setConnector('')}}
        run={run} formulaBoxes={formulaBoxes} source={line && activeSource(line) ? {page:line.page,quote:line.text,box:line.box,value:'',basis:''} : undefined}/>}</div>
      <Card padding={0} className="review-pane" role="complementary" aria-label="Review workspace">
        <div className="review-tabs">
          <TabList role="tablist" aria-label="Review views" value={tab} onChange={value=>{setTab(value as TabName);setHover(undefined)}} hasDivider>
            {(['Verify','Queue','Search'] as const).filter(name=>name!=='Verify' || selection).map(name=><Tab key={name} id={'review-tab-'+name} value={name} panelId={'review-panel-'+name}
              label={name==='Queue' ? `Queue (${unresolved})` : name}/>)}
          </TabList>
        </div>
        <div className="review-content" id={'review-panel-'+tab} role="tabpanel" aria-labelledby={'review-tab-'+tab}>
          {identify && <form className="identify" aria-label="Reviewer identity required" onSubmit={event=>{
            event.preventDefault()
            const name = String(new FormData(event.currentTarget).get('reviewer') ?? '').trim()
            if (!name) return
            onSettings({...settings,reviewer:name})
            setIdentify(undefined)
            identify.resume(name)
          }}>
            <label>Who is signing this decision?<input name="reviewer" autoFocus required maxLength={120} placeholder="Name or reviewer ID"/></label>
            <p>Every saved decision is attributed in the Activity history. This name is kept on this device.</p>
            <div className="secondary-actions"><Button type="submit" size="sm" variant="primary" label="Sign and continue"/>
              <Button size="sm" label="Cancel" onClick={()=>setIdentify(undefined)}/></div>
          </form>}
          {tab==='Queue' && <>
            <div className="review-heading"><div><h2>Review queue</h2><QueueStatus counts={counts}/><p>{visible.length} of {findings.length} findings</p></div>
              <Button label="Add figure" size="sm" onClick={()=>open({line:{page,text:'',box:[0,0,0,0]}})} isDisabled={working}/></div>
            <div className="queue-filters">
              <select aria-label="Queue status" value={queue} onChange={event=>setQueue(event.target.value)}>
                {['Unresolved','All',...statuses].map(status=><option key={status} value={status}>{status} ({status==='All' ? findings.length : status==='Unresolved' ? unresolved : counts[status as keyof typeof counts]})</option>)}
              </select>
              <select aria-label="Filter by assignee" value={assignee} onChange={event=>setAssignee(event.target.value)}>
                <option value="">All assignees</option><option value="unassigned">Unassigned</option>
                {[...new Set(Object.values(doc.assignments ?? {}).map(value=>value.assignee).filter(Boolean))].sort().map(name=><option key={name} value={'name:'+name}>{name}</option>)}</select>
              <select aria-label="Filter by priority" value={priority} onChange={event=>setPriority(event.target.value)}>
                <option value="">All priorities</option>{priorities.map(value=><option key={value}>{value}</option>)}</select>
              <select aria-label="Filter by triage" value={triage} onChange={event=>setTriage(event.target.value)}>
                <option value="">All confidence levels</option><option value="Low-Risk">Low-Risk</option>
                <option value="Exception">Variances &amp; Low-Confidence Exceptions</option>
              </select>
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
              return <button key={id} onClick={()=>open(captureFinding(candidate,doc.figures),visible,queueScope)}>
                <span><strong>{candidate.source_label ?? candidate.label}</strong><small>{[candidate.period,`p. ${candidate.source.page}`,assigned?.assignee,assigned?.priority,candidate.source.ocr?'OCR':''].filter(Boolean).join(' · ')}</small>
                  <StatusPill status={status}/>
                  {doc.drafts?.[id] && <span className="status-pill flag">Agent draft</span>}
                  {risk(candidate,rules,doc.figures,settings.triage)==='Low-Risk' && <span className="status-pill flag">Low-risk</span>}</span>
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
              <h2>{figure ? 'Edit verified figure' : finding ? 'Verify finding' : 'Capture figure'}</h2>
              <p className="queue-position">{queuePosition>=0 && <span data-queue-scope={scope}>Item {queuePosition+1} of {session.length} · {scope} filter</span>}<span>Page {line.page}</span>{finding && <StatusPill status={statusOf(finding)}/>}</p>
            </div>{queuePosition>=0 && <div className="finding-nav">
              <Button size="sm" label="Previous finding" isIconOnly icon={<kbd>[</kbd>} onClick={()=>move(-1)} isDisabled={queuePosition===0}/>
              <Button size="sm" label="Next finding" isIconOnly icon={<kbd>]</kbd>} onClick={()=>move(1)} isDisabled={queuePosition===session.length-1}/>
            </div>}</div>
            {draft && finding && <section className="agent-draft" aria-label="Proposed by Agent (Draft)">
              <div className="draft-head"><strong>Proposed by agent · draft</strong><small>{draft.agent}</small></div>
              <dl>{Object.entries(draft.changes).map(([field,value])=><div className="draft-row" key={field}>
                <dt>{({canonicalMetric:'Canonical Metric',amount:'Value',unit:'Unit',period:'Reporting period',note:'Notes'} as Record<string,string>)[field]}</dt>
                <dd><s>{field==='canonicalMetric' ? finding.canonical_metric ?? finding.label : field==='amount' ? finding.amount : field==='unit' ? finding.unit || '—' : field==='period' ? finding.period || '—' : '—'}</s>
                  {' → '}<b>{value}</b>{field==='amount' && ' '+finding.unit}</dd></div>)}</dl>
              <p>{draft.rationale}</p>
              <p className="draft-hint">Check the evidence below and on the page before approving.</p>
              <div className="secondary-actions"><Button label="Approve & Verify" variant="primary" onClick={()=>void reviewDraft(draft,true)} isDisabled={working}/>
                <Button label="Reject Draft" onClick={()=>void reviewDraft(draft,false)} isDisabled={working}/></div>
            </section>}
            {decision?.reason && statusOf(finding!)==='Excluded' && !figure && !draft ? <form className="entry" onSubmit={event=>{
              event.preventDefault();void setDecision(null,reviewer)
            }}>
              <div className="source-quote"><small>Source evidence</small><p>{line.text}</p></div>
              <div className="source-quote"><small>{decision.code ?? 'Decision reason'}</small><p>{decision.reason}</p><small>{decision.reviewer}</small></div>
              <Button type="submit" label="Return to review queue" variant="primary" isLoading={busy}/>
            </form> : disposition && !draft ? <form className="entry" onSubmit={event=>{
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const code = String(data.get('code') ?? '')
              const note = String(data.get('reason') ?? '').trim()
              void setDecision(note || code,reviewer,code,disposition)
            }}>
              <strong>{disposition==='On hold' ? 'Place on hold' : disposition==='Excluded' ? 'Exclude finding' : 'Escalate finding'}</strong>
              <label>Reason code<select name="code" aria-label="Reason code" required defaultValue=""><option value="" disabled>Select a reason</option>
                {(settings.reasons.length ? settings.reasons : defaultReasons).map(reason=><option key={reason}>{reason}</option>)}</select></label>
              <label>Details<textarea name="reason" maxLength={1000} placeholder="Add context for the next reviewer"/></label>
              <div className="form-actions"><Button label="Cancel" onClick={()=>setDisposition(undefined)} isDisabled={working}/>
                <Button type="submit" label="Save decision" variant="primary" isLoading={busy} isDisabled={scanning}/></div>
            </form> : <CaptureForm key={anchor+(draft ? ':draft' : '')} readOnly={!!draft} line={line} figure={figure} finding={finding}
              reviewer={reviewer} working={working} busy={busy} scanning={scanning} hasNext={!!finding && !figure} triage={finding && risk(finding,rules,doc.figures,settings.triage)} escalated={decision?.status==='Escalated'}
              verdict={decision?.reason || undefined} formula={formula}
              onFormula={rule=>{setPage(rule.total.source.page);setFormula(current=>current===rule ? undefined : rule)}}
              ties={scopedTies} split={split} onSplit={tie=>{setSplit(current=>current?.id===tie.id ? undefined : tie);setHover(undefined)}}
              rules={scopedRules} figures={doc.figures} assignment={assignment} selected={formLinked}
              onLink={value=>{setHover(value ? anchor : undefined);if (!value) setConnector('')}}
              onSave={(value,advance,routing)=>void save(value,advance,false,routing)} onDecision={setDisposition} onDelete={id=>id ? setDeleting(id) : setIdentify({resume:setDeleting})}
              periods={analysis.items.flatMap(value=>value.period ? [value.period] : [])}
              units={analysis.items.flatMap(value=>value.unit ? [value.unit] : [])}
              onError={setError} needsOcr={doc.ocrPages?.includes(line.page)}/>}
          </>}
        </div>
      </Card>
      {formLinked && connector && <svg className="anchor-line" aria-hidden="true"><path d={connector}/></svg>}
    </div>
    </div>
    <SealDialog doc={doc} isOpen={sealing} onOpenChange={setSealing} settings={settings} onSettings={onSettings}
      onSealed={(updated,message)=>{onChange(updated);setAnnouncement(message)}}/>
    <WorkpaperRegister doc={doc} onSeal={()=>setSealing(true)} onOpen={openFigure} onExport={(format,figures)=>void exportFile(format,figures)}
      onCsv={figures=>downloadRegister(figures.map(figure=>({figure,document:doc.name})),doc.name.replace(/\.pdf$/i,'')+'-register.csv')}/>
    <AlertDialog isOpen={confirmScan} onOpenChange={setConfirmScan} title="Re-index OCR?"
      description="This page has verified figures. Re-indexing replaces the page highlights and retains the original citations in the register."
      actionLabel="Re-index OCR" onAction={()=>{setConfirmScan(false);void recognize()}}/>
    <AlertDialog isOpen={deleting!==undefined} onOpenChange={value=>{if (!busy && !value) setDeleting(undefined)}} title="Delete verified figure?"
      description="The figure will be removed from the register. Its values and citation will be recorded in Activity history."
      actionLabel="Delete figure" isActionLoading={busy} onAction={()=>figure && deleting && save({...figure,reviewer:deleting},false,true)}/>
  </div>
}

function CaptureForm({ties,split,onSplit,readOnly=false,line,figure,finding,reviewer,working,busy,scanning,hasNext,triage,escalated,verdict,formula,onFormula,rules,figures,assignment,selected,onLink,
  onSave,onDecision,onDelete,periods,units,onError,needsOcr}: {
  line:Line; figure?:Figure; finding?:Finding; reviewer:string; working:boolean; busy:boolean; scanning:boolean; hasNext:boolean
  rules:Rule[]; figures:Figure[]; assignment?:Assignment; triage?:string; escalated?:boolean; verdict?:string; formula?:Rule; onFormula:(rule:Rule)=>void
  selected:boolean; onLink:(value:boolean)=>void; onSave:(figure:Figure,advance:boolean,routing:Pick<Assignment,'assignee'|'priority'>)=>void
  onDecision:(value:Disposition)=>void; onDelete:(reviewer:string)=>void; readOnly?:boolean
  ties:TieOut[]; split?:TieOut; onSplit:(tie:TieOut)=>void
  periods:string[]; units:string[]; onError:(message:string)=>void; needsOcr?:boolean
}) {
  const native = figure && sourceScale(figure)
  const [amount,setAmount] = useState(native?.amount ?? finding?.amount ?? '')
  const [unit,setUnit] = useState(native?.unit ?? finding?.unit ?? '')
  const [period,setPeriod] = useState(figure?.period ?? finding?.period ?? '')
  const [label,setLabel] = useState(figure?.label ?? finding?.canonical_metric ?? finding?.label ?? line.text.split(/(?:[0-9]|[$£€])/)[0].replace(/[^a-zA-Z)]+$/,'').trim())
  const [quote,setQuote] = useState(line.text)
  const [note,setNote] = useState(figure?.note ?? '')
  useEffect(()=>{setQuote(line.text)},[line])
  const baseline = native ?? (finding && {...finding,label:finding.canonical_metric ?? finding.label})
  const edited = !!baseline && (label.trim()!==baseline.label || amount.trim()!==baseline.amount || unit.trim()!==baseline.unit ||
    period.trim()!==baseline.period || quote.trim()!==baseline.source.text || line.page!==baseline.source.page ||
    line.box.some((value,index)=>value!==baseline.source.box[index]) || !!figure && note.trim()!==figure.note)
  const original = figure?.original ?? finding
  const verbatim = figure?.verbatimLabel ?? finding?.source_label ?? line.row_label ?? finding?.label
  const sourceUnit = original?.unit
  const unitLocked = !!sourceUnit && !original?.review_flags?.includes('missing_currency')
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
    if (sourceUnit && scaleName(unit)!==scaleName(sourceUnit)) return onError('Keep the value in the source document’s scale.')
    if (edited && !reason) return onError('Enter the reason for changing the figure.')
    onSave({
      id:figure?.id ?? crypto.randomUUID(),label:label.trim(),verbatimLabel:verbatim,amount:amount.trim(),unit:unit.trim(),period:period.trim(),note:note.trim(),
      source:{...line,text:quote.trim()},saved:new Date().toISOString(),reviewer,original,
      changeReason:reason,findingKey:figure?.findingKey ?? (finding && findingKey(finding)),
    }, (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='next', {assignee:read('assignee'),priority:(read('priority') || 'Normal') as Priority})
  }}>
    <fieldset className="entry-fields" disabled={readOnly} aria-label={readOnly ? 'Finding under agent review' : undefined}>
    <div className="finding-meta">
      <span className={`status-pill flag`}>
        {line.confidence!==undefined ? `OCR confidence ${Math.round(line.confidence)}%` : line.ocr || needsOcr ? 'OCR confidence unavailable' : 'PDF text layer'}
      </span>
      {triage==='Low-Risk' && <span className="status-pill flag">Low-risk</span>}
      {weak && <span className="status-pill flag">Review required</span>}
      {finding?.review_flags?.map(flag=><span key={flag} className="meta-flag">{flag.replaceAll('_',' ')}</span>)}
    </div>
    {verdict && <p className="decision-note">{verdict}</p>}
    {verbatim && <label>Verbatim Label<input value={verbatim} readOnly/></label>}
    <label>Canonical Metric<input name="label" value={label} maxLength={500} onChange={event=>setLabel(event.target.value)} required/></label>
    <div className="pair">
      <label>Value<input name="amount" value={amount} onChange={event=>setAmount(event.target.value)} required maxLength={80}
        pattern="-?[0-9]+([.][0-9]+)?" inputMode="decimal" list="source-amounts" placeholder="Numeric value"/></label>
      <label>Unit<input name="unit" value={unit} onChange={event=>setUnit(event.target.value)} maxLength={120} readOnly={unitLocked} list="source-units" placeholder="Select or enter"/></label>
    </div>
    <div className="extracted">Normalized <output aria-label="Normalized">{formattedAmount(amount,unit)}</output></div>
    <label>Reporting period<input name="period" list="source-periods" readOnly={!!line.column_heading} value={period} onChange={event=>setPeriod(event.target.value)} maxLength={120} placeholder="Select or enter"/></label>
    <datalist id="source-periods">{suggestedPeriods.map(value=><option key={value} value={value}/>)}</datalist>
    <datalist id="source-units">{suggestedUnits.map(value=><option key={value} value={value}/>)}</datalist>
    <datalist id="source-amounts">{[...new Set((line.text.match(/(?:\(\d[\d,]*(?:\.\d+)?\)|-?\d[\d,]*(?:\.\d+)?)/g) ?? [])
      .map(value=>value.replaceAll(',','').replace(/^\((.*)\)$/,'-$1')))].slice(0,24).map(value=><option key={value} value={value}/>)}</datalist>
    <label data-source-field className={selected ? 'linked-field' : undefined} onMouseEnter={()=>onLink(true)} onMouseLeave={()=>onLink(false)}
      onFocus={()=>onLink(true)} onBlur={()=>onLink(false)}>
      Source citation · p. {line.page}<textarea name="quote" required readOnly={!!line.column} value={quote} maxLength={16000} onChange={event=>setQuote(event.target.value)}
        placeholder="Select an area on the PDF or enter source text"/>
    </label>
    {ties.map(tie=>{
      const other = finding && findingKey(tie.a.finding)===findingKey(finding) ? tie.b : tie.a
      return <button type="button" key={tie.id} aria-pressed={split?.id===tie.id} onClick={()=>onSplit(tie)}
        className={'tieout-alert'+(tie.failed ? ' failed' : '')}>
        <span><strong>{tie.failed ? `Cross-Page Tie-Out Variance: ${tie.difference.replace(/^-/,'')} ${tie.unit}` : `Ties to page ${other.page}`}</strong>
          <small className="tabular">p. {tie.a.page} ({tie.a.amount}) {tie.failed ? 'vs' : '='} p. {tie.b.page} ({tie.b.amount}) · {tie.period}</small></span>
        <span className="tieout-open">{split?.id===tie.id ? 'Close split' : 'Open split view'}</span>
      </button>
    })}
    {rules.map((rule,index)=>{
      const result = variance(rule,figures,finding && {finding,amount,unit,period})
      return <button type="button" aria-pressed={formula===rule} onClick={()=>onFormula(rule)} className={`math-check ${result && !result.failed ? 'verified' : 'review'}`} key={index}>
        {result && !result.failed ? <Check size={15}/> : <ShieldAlert size={15}/>}
        <span><strong>{rule.name}</strong> · {result ? result.failed ? `Variance ${result.difference} ${rule.total.unit}` : 'Reconciles' : 'Check units or periods'}{formula===rule && result && <b className="equation">{result.equation}</b>}</span>
      </button>
    })}
    {edited && <label>Change reason<input name="change-reason" required maxLength={500} placeholder="e.g. Adjusted scale"/></label>}
    <label>Notes<textarea name="note" value={note} maxLength={4000} onChange={event=>setNote(event.target.value)} placeholder="Optional"/></label>
    </fieldset>
    {finding && !readOnly && <details className="assignment">
      <summary>{assignment ? `Assignment · ${assignment.assignee || 'Unassigned'} · ${assignment.priority}` : 'Assignment and priority'}</summary>
      <div className="pair">
        <label>Assignee<input name="assignee" defaultValue={assignment?.assignee} maxLength={120} placeholder="Unassigned"/></label>
        <label>Priority<select name="priority" aria-label="Priority" defaultValue={assignment?.priority ?? 'Normal'}>{priorities.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
    </details>}
    {!readOnly && <div className="form-actions">
      <Button type="submit" name="action" data-save-next={hasNext ? '' : undefined} value={hasNext ? 'next' : 'save'} label={escalated ? 'Approve & Verify' : figure ? 'Save changes' : hasNext ? 'Save & next' : 'Save figure'}
        variant="primary" className="save-action" icon={<Check size={16}/>} endContent={hasNext ? <kbd aria-hidden="true">Ctrl/⌘ ↵</kbd> : undefined} isLoading={busy} isDisabled={scanning}/>
      <div className="secondary-actions">
        {hasNext && <Button type="submit" size="sm" label="Save only" isDisabled={working}/>}
        {finding && !figure && <><Button size="sm" label="Exclude" endContent={<kbd aria-hidden="true">E</kbd>} onClick={()=>onDecision('Excluded')} isDisabled={working}/>
          <Button size="sm" label="Hold" endContent={<kbd aria-hidden="true">H</kbd>} onClick={()=>onDecision('On hold')} isDisabled={working}/>
          <Button size="sm" label="Escalate" endContent={<kbd aria-hidden="true">⇧E</kbd>} onClick={()=>onDecision('Escalated')} isDisabled={working}/></>}
        {figure && <Button size="sm" label="Delete figure" onClick={()=>onDelete(reviewer)} isDisabled={working}/>}
      </div>
    </div>}
  </form>
}
