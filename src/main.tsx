import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, BookOpen, Check, ChevronRight, CircleAlert, CircleCheck, ClipboardList, FileText, History, PanelTop, Layers3, ScanLine, Files, RotateCcw, UploadCloud, X } from 'lucide-react'
import { Document } from './Document'
import { exportReview, formatAmount, loadDecisions, samplePdf, saveDecisions, type Decision, type Decisions, type Evidence, type Metric, type Review } from './model'
import { readDraft, writeDraft, type Draft } from './draft'
import { importPdf } from './importPdf'
import './style.css'
import './workbench.css'

const labels = { ready: 'To verify', conflict: 'Conflict', limited: 'Provisional', missing: 'Missing' }

function defaultSource(metric?: Metric) {
  return metric?.evidence.find(item => item.basis === 'actual' || item.basis === 'reported') ?? metric?.evidence[0]
}

function App() {
  const [review, setReview] = useState<Review>()
  const [decisions, setDecisions] = useState<Decisions>(loadDecisions)
  const [selected, setSelected] = useState('revenue')
  const [source, setSource] = useState<Evidence>()
  const [page, setPage] = useState(18)
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<'all' | 'open'>('all')
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')
  const [pdfUrl, setPdfUrl] = useState(samplePdf)
  const [local, setLocal] = useState(false)
  const [mobilePane, setMobilePane] = useState<'review' | 'document'>('review')
  const [reading, setReading] = useState('Reading document…')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [reopening, setReopening] = useState(false)
  const [exclusion, setExclusion] = useState(false)
  const auditDialog = useRef<HTMLDialogElement>(null)
  const uploadDialog = useRef<HTMLDialogElement>(null)
  const draft = useRef<Draft | undefined>(undefined)
  const uploadedUrl = useRef<string | undefined>(undefined)
  const metric = review?.metrics.find(row => row.id === selected)
  const decision = metric && decisions[metric.id]
  const done = review?.metrics.filter(row => decisions[row.id]).length ?? 0
  const total = review?.metrics.length ?? 0
  const needsReason = !!metric && (metric.status !== 'ready' || source?.basis === 'forecast' || source?.basis === 'provisional')
  const canExport = total > 0 && total === done

  function select(row: Metric, existing?: Decision) {
    const evidence = row.evidence.find(item => item.page === existing?.source?.page && item.quote === existing?.source?.quote) ?? defaultSource(row)
    setSelected(row.id)
    setSource(evidence)
    setPage(evidence?.page ?? 1)
    setNote(existing?.note ?? '')
    setReopening(false)
    setExclusion(false)
  }

  async function loadSample(reset = false) {
    setProblem('')
    try {
      const response = await fetch('/demo/review.json')
      if (!response.ok) throw new Error('Failed to load the sample review.')
      const data: Review = await response.json()
      if (uploadedUrl.current) await writeDraft()
      draft.current = undefined
      const saved = reset ? {} : loadDecisions()
      if (reset) saveDecisions(saved)
      if (uploadedUrl.current) URL.revokeObjectURL(uploadedUrl.current)
      uploadedUrl.current = undefined
      setReview(data)
      setDecisions(saved)
      setPdfUrl(samplePdf)
      setFilter('all')
      select(data.metrics[0], saved[data.metrics[0].id])
      if (reset) setNotice('Sample review reset.')
    } catch {
      setProblem('The sample review could not load. Refresh the workspace to try again.')
    }
  }

  useEffect(() => {
    void readDraft().then(saved => {
      if (!saved) return loadSample()
      draft.current = saved
      const url = URL.createObjectURL(saved.file)
      uploadedUrl.current = url
      setPdfUrl(url)
      setReview(saved.review)
      setDecisions(saved.decisions)
      const first = saved.review.metrics.find(row => !saved.decisions[row.id]) ?? saved.review.metrics[0]
      select(first, saved.decisions[first.id])
    }).catch(() => loadSample())
    fetch('/api/health').then(async response => {
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        setLocal((await response.json()).status === 'ok')
      }
    }).catch(() => {})
    return () => { if (uploadedUrl.current) URL.revokeObjectURL(uploadedUrl.current) }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  function record(status: Decision['status']) {
    if (!metric || !review || (status === 'Approved' && !source)) return
    if ((status === 'Excluded' || needsReason) && !note.trim()) {
      setNotice('Add a reviewer note to record this decision.')
      return
    }
    const next = { ...decisions, [metric.id]: { status, source: status === 'Approved' ? source : undefined, note: note.trim(), timestamp: new Date().toISOString() } }
    setDecisions(next)
    if (pdfUrl === samplePdf) saveDecisions(next)
    setNotice(`${metric.name}: ${status.toLowerCase()}.`)
    if (draft.current) {
      draft.current = {...draft.current, decisions: next}
      void writeDraft(draft.current).catch(() => setNotice('Browser storage failed. Export before closing this tab.'))
    }
    const nextOpen = [...review.metrics.slice(review.metrics.indexOf(metric) + 1), ...review.metrics].find(row => !next[row.id])
    if (nextOpen) select(nextOpen)
    else {
      if (filter === 'open') setFilter('all')
      setReopening(false)
      setExclusion(false)
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    if (!(file instanceof File) || !file.size) return
    setUploading(true)
    setUploadError('')
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a PDF smaller than 20 MB.')
      setReading('Reading document…')
      let data: Review
      if (local) {
      const response = await fetch('/api/extract', { method: 'POST', body: form })
      data = await response.json()
      if (!response.ok) throw new Error('Unable to extract this PDF. Check its size, format and encryption.')
      } else { data = await importPdf(file, String(form.get('period')), setReading) }
      const newDraft = {file, review: data, decisions: {}}
      await writeDraft(newDraft)
      draft.current = newDraft
      if (uploadedUrl.current) URL.revokeObjectURL(uploadedUrl.current)
      const url = URL.createObjectURL(file)
      uploadedUrl.current = url
      setPdfUrl(url)
      setReview(data)
      setDecisions({})
      setFilter('all')
      select(data.metrics[0])
      uploadDialog.current?.close()
      setNotice(data.text_pages ? 'Extraction complete. Review the source evidence before export.' : 'No selectable text found. This prototype does not perform OCR.')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to extract this document.')
    } finally {
      setUploading(false)
    }
  }

  return <>
    <header className="topbar">
      <div className="top-inner">
        <div className="brand"><span className="brand-symbol"><Layers3 size={22}/></span><span>folio<span className="brand-dot">.</span></span></div>
        <span className="header-divider"/>
        <span className="workspace-label">Document intelligence</span>
        <span className="demo-tag">{pdfUrl === samplePdf ? 'Sample workspace' : 'Local PDF review'}</span>
      </div>
    </header>
    <main className="workspace">
      {problem && <p role="alert">{problem}</p>}
      {!review && !problem && <p role="status">Loading review…</p>}
      {review && <>
        <section className="hero" aria-label="Review overview">
          <div>
            <div className="eyebrow"><Files size={14}/> Workspace <ChevronRight size={13}/> Financial review</div>
            <h1>{review.title}</h1>
            <p className="hero-copy" hidden>Financial evidence review</p>
            <div className="metadata"><span><FileText size={15}/>{review.pages} pages</span><i/><span>{review.metrics[0]?.period}</span><i/><span>{total} financial metrics</span></div>
          </div>
          <div className="hero-actions">
            {<button className="button secondary" onClick={() => { setUploadError(''); uploadDialog.current?.showModal() }}><UploadCloud size={17}/> Import PDF</button>}
            <button className="button secondary" onClick={() => auditDialog.current?.showModal()}><History size={17}/> Review log</button>
            <button className="button primary" disabled={!canExport} onClick={() => { exportReview(review, decisions); setNotice('Review CSV downloaded.') }}><ArrowDownToLine size={17}/> Export CSV</button>
          </div>
        </section>

        <div className="progress-panel">
          <span className="progress-icon"><CircleCheck size={19}/></span>
          <div className="progress-text"><strong>Review progress</strong><span>{canExport ? 'All decisions recorded. Your CSV is ready.' : 'Approve or exclude each metric to unlock export.'}</span></div>
          <div className="progress-right"><strong>{done} <span>/ {total} reviewed</span></strong><progress aria-label="Review progress" max={total} value={done}/></div>
        </div>

        <div className="mobile-switch"><button aria-pressed={mobilePane === 'review'} onClick={() => setMobilePane('review')}><ClipboardList size={16}/>Review figures</button><button aria-pressed={mobilePane === 'document'} onClick={() => setMobilePane('document')}><ScanLine size={16}/>Read document</button></div>
        <div className="split" data-pane={mobilePane}>
          <div className="left-column">
            <section className="panel queue" aria-label="Extracted metrics">
              <div className="section-heading">
                <div><h2>Extracted metrics</h2><p>Choose a figure to review its source.</p></div>
                <div className="filter" aria-label="Filter metrics">
                  <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
                  <button aria-pressed={filter === 'open'} onClick={() => { setFilter('open'); const first = review.metrics.find(row => !decisions[row.id]); if (first && decisions[selected]) select(first) }}>Open</button>
                </div>
              </div>
              <div className="table-head"><span>METRIC</span><span>VALUE</span><span>STATUS</span><span/></div>
              {review.metrics.filter(row => filter === 'all' || !decisions[row.id]).map(row => {
                const result = decisions[row.id]
                const suggestion = row.status === 'missing' || row.status === 'conflict' ? undefined : defaultSource(row)
                const value = result ? result.source?.value : suggestion?.value
                return <button key={row.id} className="metric-row" aria-pressed={selected === row.id} onClick={() => select(row, result)}>
                  <span className="metric-name">{row.name}</span>
                  <span className="metric-value">{value !== undefined ? formatAmount(value) : '—'}</span>
                  <span className={`status ${result?.status.toLowerCase() ?? row.status}`}>{result?.status ?? labels[row.status]}</span>
                  <ChevronRight className="row-arrow" size={16}/>
                </button>
              })}
              {filter === 'open' && canExport && <p className="empty-queue">All metrics have a review decision.</p>}
            </section>
            {metric && <section className="panel evidence" aria-labelledby="evidence-title">
              <div className="section-heading evidence-heading">
                <div><div className="eyebrow"><BookOpen size={14}/> SOURCE EVIDENCE</div><h2 id="evidence-title">{metric.name}</h2></div>
                <span className="source-count">{metric.evidence.length} {metric.evidence.length === 1 ? 'source' : 'sources'}</span>
              </div>
              <p className={`reason ${metric.status}`}>{metric.status !== 'ready' && <CircleAlert size={16}/>}<span>{metric.reason}</span></p>
              <div className="source-list">
                {metric.evidence.map((item, index) => <button className="source-card" key={index} aria-pressed={item === source}
                  onClick={() => { setSource(item); setPage(item.page); setMobilePane('document') }}>
                  <span className="source-main"><strong>{formatAmount(item.value)}</strong><span>{item.basis}</span></span>
                  <span className="source-page">Page {item.page}<ChevronRight size={15}/></span>
                  <span className="quote">{item.quote}</span>
                </button>)}
              </div>
              {decision && !reopening ? <div className="recorded">
                <div><strong><Check size={16}/> {decision.status}{decision.source ? ` · ${formatAmount(decision.source.value)} · p. ${decision.source.page}` : ''}</strong>{decision.note && <p>{decision.note}</p>}</div>
                <button className="button secondary compact" onClick={() => { setReopening(true); setNotice('Editing the decision. The saved review remains in effect until you save.'); setNote(decision.note) }}>Edit decision</button>
              </div> : <>
                {(note !== '' || exclusion || needsReason) && <label className="note-label" htmlFor="reviewer-note">Reviewer note <span>{exclusion || needsReason ? 'Required' : 'Optional'}</span>
                  <textarea id="reviewer-note" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Explain the source choice or exclusion."/>
                </label>}
                <div className="decision-actions">
                  {exclusion ? <button className="button secondary compact" onClick={() => setExclusion(false)}>Cancel exclusion</button> : <button className="button secondary compact" onClick={() => setExclusion(true)}>Exclude metric</button>}
                  <button className="button primary compact" disabled={exclusion ? !note.trim() : !source || (needsReason && !note.trim())}
                    onClick={() => record(exclusion ? 'Excluded' : 'Approved')}><Check size={16}/>{exclusion ? 'Confirm exclusion' : 'Approve selected value'}</button>
                </div>
              </>}
            </section>}
          </div>
          <Document url={pdfUrl} filename={review.filename} page={page} pages={review.pages} onPage={setPage} source={source}/>
        </div>
        <footer className="footer">
          <span><PanelTop size={15}/> Folio · Dhia Eddine Mahdaoui</span>
          <button className="text-button" onClick={() => { if (window.confirm(pdfUrl !== samplePdf ? 'Remove this imported draft and return to the sample?' : 'Reset all decisions for the sample review?')) void loadSample(pdfUrl === samplePdf) }}><RotateCcw size={14}/> {pdfUrl === samplePdf ? 'Reset sample review' : 'Return to sample'}</button>
        </footer>
        <dialog ref={auditDialog} className="modal" aria-labelledby="log-title">
          <div className="modal-head"><h2 id="log-title">Review log</h2><button className="icon-button" aria-label="Close review log" onClick={() => auditDialog.current?.close()}><X size={20}/></button></div>
          <p>Latest recorded decision for each metric in this review.</p>
          {done === 0 && <p className="empty-log">No decisions recorded yet.</p>}
          <ul className="log-list">{Object.entries(decisions).sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp)).map(([id, result]) => <li key={id}>
            <strong>{review.metrics.find(row => row.id === id)?.name ?? id}</strong><span>{result.status}{result.source ? ` · ${formatAmount(result.source.value)} · Page ${result.source.page}` : ''}</span>
            {result.note && <p>{result.note}</p>}<small>{new Date(result.timestamp).toLocaleString()}</small></li>)}</ul>
        </dialog>
        <dialog ref={uploadDialog} className="modal" aria-labelledby="import-title">
          <div className="modal-head"><h2 id="import-title">Import a PDF</h2><button className="icon-button" aria-label="Close upload" disabled={uploading} onClick={() => uploadDialog.current?.close()}><X size={20}/></button></div>
          <p>Review a text-readable PDF up to 20 MB and 500 pages. This browser saves your current PDF and decisions. Importing another PDF or returning to the sample replaces that draft. The extractor supports lines such as <strong>FY2025 reported Revenue: £128.4m</strong>.</p>
          <p><a href={samplePdf} download>Download the 400-page example PDF</a></p>
          <form className="upload-form" onSubmit={upload}>
            <label>PDF file<input type="file" name="file" accept="application/pdf,.pdf" required disabled={uploading}/></label>
            <label>Fiscal year<input type="number" name="period" min="2000" max="2099" defaultValue="2025" required disabled={uploading}/></label>
            {uploadError && <p role="alert">{uploadError}</p>}
            <button className="button primary" disabled={uploading}><UploadCloud size={17}/>{uploading ? reading : 'Extract evidence'}</button>
          </form>
        </dialog>
      </>}
      <div className="live-notice" role="status">{notice && <span>{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15}/></button></span>}</div>
    </main>
  </>
}

createRoot(document.getElementById('root')!).render(<App/>)
