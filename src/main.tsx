import {lazy, Suspense, useEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AlertDialog} from '@astryxdesign/core/AlertDialog'
import {Card} from '@astryxdesign/core/Card'
import {EmptyState} from '@astryxdesign/core/EmptyState'
import {Heading} from '@astryxdesign/core/Heading'
import {Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow} from '@astryxdesign/core/Table'
import {Badge} from '@astryxdesign/core/Badge'
import {Button} from '@astryxdesign/core/Button'
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu'
import {ProgressBar} from '@astryxdesign/core/ProgressBar'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Theme} from '@astryxdesign/core/theme'
import {neutralTheme} from '@astryxdesign/theme-neutral/built'
import {ArrowDown, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, CheckCheck, ClipboardList, FileText, FolderOpen, LibraryBig, MoreHorizontal, Plus, Search, Table2, Terminal, Trash2, Upload, X} from 'lucide-react'
import {list, get, change, indexPdf, downloadRegister, type Figure, type Header, type RecordFile} from './register'
import {readDraft, writeDraft} from './draft'
import {preferences} from './preferences'
import {AgentHub} from './AgentHub'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import './style.css'
import './library.css'
import './workspace.css'
import './desk.css'

const LibraryPreview = lazy(() => import('./LibraryPreview').then(module => ({default: module.LibraryPreview})))
const Reader = lazy(() => import('./Reader').then(module => ({default: module.Reader})))

type View = 'Documents' | 'Review queue' | 'Figure register' | 'Agent MCP & Skill'
const views = [{label:'Documents',short:'Documents',icon:LibraryBig}, {label:'Review queue',short:'Queue',icon:ClipboardList},
  {label:'Figure register',short:'Register',icon:Table2}, {label:'Agent MCP & Skill',short:'Agent tools',icon:Terminal}] as const
const sampleName = 'Northfield FY2025 (Sample).pdf'

function App() {
  const [items, setItems] = useState<Header[]>([])
  const [active, setActive] = useState<{doc: RecordFile; figure?: string}>()
  const [view, setView] = useState<View>('Documents')
  const [settings,setSettings] = useState(preferences)
  const [railDrag,setRailDrag] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [deletion, setDeletion] = useState<Header>()
  const [deleting, setDeleting] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const locked = useRef(false)

  async function refresh() {
    setItems((await list()).sort((a,b) => b.added.localeCompare(a.added)))
  }

  useEffect(() => {
    async function initialize() {
      const old = await readDraft()
      if (old && !localStorage.getItem('folio-migrated-draft')) {
        const imported = await indexPdf(old.file, setMessage)
        await change(imported.id, prior => {
          if (!prior) throw Error()
          const figures = old.review.metrics.flatMap(metric => {
            const decision = old.decisions[metric.id]
            const source = decision?.source
            if (!source || decision.status !== 'Approved' || prior.figures.some(f => f.id === 'legacy-' + metric.id)) return []
            return [{
              id: 'legacy-' + metric.id, label: metric.name, amount: source.value, unit: metric.unit,
              period: metric.period, note: decision.note,
              source: {text: source.quote, page: source.page, box: source.box}, saved: decision.timestamp,
            }]
          })
          return {...prior, figures: [...prior.figures, ...figures]}
        })
        localStorage.setItem('folio-migrated-draft', imported.id)
      }
      await refresh()
    }
    void initialize().catch(() => setError('Could not open browser storage. Allow site data and reload.')).finally(() => {
      setMessage('')
      setLoading(false)
    })
  }, [])

  async function ingest(files: File[], sample = false) {
    if (locked.current || loading || !files.length) return
    locked.current = true
    setError('')
    const problems: string[] = []
    try {
      for (const [index, file] of files.entries()) {
        try {
          const extension = file.name.toLowerCase().split('.').pop()
          if (extension !== 'pdf' && extension !== 'folio') throw Error('Choose a PDF or Folio workpaper.')
          const prefix = files.length > 1 ? `File ${index + 1} of ${files.length} · ` : ''
          setMessage(prefix + 'Opening ' + file.name)
          const progress = (step: string) => setMessage(prefix + step + ' · ' + file.name)
          const doc = extension === 'folio'
            ? await (await import('./backup')).restore(file, progress)
            : await indexPdf(file, progress, sample)
          if (files.length === 1) setActive({doc})
        } catch (error) {
          problems.push(file.name + ' — ' + (error instanceof Error ? error.message : 'Import failed.'))
        }
      }
      if (files.length > 1) setView('Documents')
      await refresh()
    } catch {
      problems.push('Could not refresh the document list.')
    } finally {
      locked.current = false
      setMessage('')
      setError(problems.join(' · '))
    }
  }

  async function openSample() {
    if (locked.current) return
    try {
      const response = await fetch('/northfield-sample.pdf')
      if (!response.ok) throw Error()
      const file = new File([await response.blob()], sampleName, {type:'application/pdf'})
      await ingest([file], true)
    } catch {
      setError('Could not load the sample PDF. Try again.')
    }
  }

  async function openDocument(id: string, figure?: string) {
    try {
      const doc = await get(id)
      if (!doc) throw Error()
      setError('')
      setActive({doc, figure})
    } catch {
      setError('This document is unavailable. Refresh the library and try again.')
    }
  }

  async function removeDocument() {
    if (!deletion || deleting) return
    setDeleting(true)
    setError('')
    try {
      await change(deletion.id, () => undefined)
      const old = await readDraft()
      if (old && old.file.name === deletion.name) await writeDraft()
      await refresh()
    } catch {
      setError('Could not complete the deletion. Refresh the library and try again.')
    } finally {
      setDeletion(undefined)
      setDeleting(false)
    }
  }

  const pending = items.reduce((total, item) => total + (item.review?.pending ?? 0) + (item.review?.unresolved ?? 0), 0)
  const canImport = !message && !loading
  const chooseFiles = () => picker.current?.click()
  function navigate(next: View) {
    if (active) void refresh().catch(() => setError('Library refresh failed.'))
    setActive(undefined)
    setView(next)
  }

  return <div className="app">
    <input ref={picker} type="file" hidden multiple accept=".pdf,.folio,application/pdf" aria-label="Choose documents"
      onChange={event => {void ingest(Array.from(event.target.files ?? [])); event.target.value = ''}}/>
    <aside className="workspace-rail" aria-label="Workspace sidebar">
      <button type="button" className="rail-brand" onClick={()=>navigate('Documents')}>
        <img className="brand-icon" src="/folio.svg" alt=""/>
        <span><strong>FOLIO</strong><small>Review workspace</small></span>
      </button>
      <nav className="rail-nav" aria-label="Workspace navigation">
        {views.map(({label,short,icon:Icon})=><button type="button" aria-label={label} key={label} onClick={()=>navigate(label)}
          aria-current={(active ? label==='Review queue' : label===view) ? 'page' : undefined}>
          <Icon size={16}/><span className="rail-label">{label}</span><span className="rail-label-short" aria-hidden="true">{short}</span>{label==='Review queue' && pending>0 && <small>{pending}</small>}
        </button>)}
      </nav>
      <div className="rail-library">
        <div className="rail-library-heading"><h2>Library</h2><Button size="sm" variant="ghost" label="Import PDF or Folio backup" icon={<Plus size={16}/>} isIconOnly onClick={chooseFiles} isDisabled={!canImport}/></div>
        <div className="rail-files">
          {items.map(item=><button type="button" key={item.id} title={item.name} aria-pressed={active?.doc.id===item.id}
            onClick={()=>{if(active?.doc.id!==item.id)void openDocument(item.id)}}>
            <span className="rail-file-icon"><FileText size={15}/></span>
            <span><strong>{item.name}</strong><small>
              {!!item.review?.unresolved && <span className="status-pill review">{item.review.unresolved} unresolved</span>}
              {!!item.review?.pending && <span className="status-pill neutral">{item.review.pending} to review</span>}
              {!!item.review?.scans && <span className="status-pill review">OCR</span>}
              {!item.review?.pending && !item.review?.unresolved && <span className="status-pill verified">{item.count ? item.count+' verified' : 'Indexed'}</span>}
            </small></span>
          </button>)}
          {!items.length && <button type="button" className="rail-sample" onClick={openSample} disabled={!canImport}><BookOpen size={16}/><span><strong>Open sample workpaper</strong></span></button>}
        </div>
      </div>
      <button type="button" className={railDrag ? 'rail-import dragging' : 'rail-import'} onClick={chooseFiles} disabled={!canImport}
        onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();setRailDrag(canImport)}}}
        onDragLeave={()=>setRailDrag(false)} onDrop={event=>{event.preventDefault();setRailDrag(false);if(canImport)void ingest(Array.from(event.dataTransfer.files))}}>
        <Upload size={20}/><strong>Import documents</strong><span>Drop PDF or .folio files</span>
      </button>
      <a className="api-reference rail-api" href="/api/v2" target="_blank" rel="noreferrer">API reference <ArrowUpRight size={13}/></a>
    </aside>
    <main className="workspace-main">
      {error && <div className="notice error" role="alert"><span>{error}</span><Button variant="ghost" label="Dismiss error" icon={<X size={16}/>} isIconOnly onClick={() => setError('')}/></div>}
      {message && <div className="notice" role="status"><ProgressBar label="Import in progress" isLabelHidden isIndeterminate/><span>{message}</span></div>}
      {active ? <Suspense fallback={<div className="notice" role="status">Opening workpaper…</div>}>
        <Reader key={active.doc.id+':'+(active.figure ?? '')} initial={active.doc} initialFigure={active.figure} back={() => navigate(view==='Review queue' ? view : 'Documents')}
          settings={settings} onChange={()=>void refresh().catch(()=>setError('Library refresh failed.'))}/>
      </Suspense> :
        view === 'Agent MCP & Skill' ? <AgentHub settings={settings} onSettings={setSettings}/> :
        view === 'Figure register' ? <Register items={items} loading={loading} onOpen={openDocument} onBrowse={() => navigate('Documents')}/> :
        <Library key={view} view={view} items={items} loading={loading}
          canImport={canImport} onImport={chooseFiles} onDrop={ingest} onSample={openSample} onOpen={openDocument}
          onDelete={setDeletion}/>}
    </main>
    <AlertDialog isOpen={!!deletion} onOpenChange={value => {if (!value && !deleting) setDeletion(undefined)}}
      title="Delete document?" description={`“${deletion?.name ?? ''}” and its review decisions will be removed from this browser.`}
      actionLabel="Delete document" isActionLoading={deleting} onAction={removeDocument}/>
  </div>
}

function Library({view, items, loading, canImport, onImport, onDrop, onSample, onOpen, onDelete}: {
  view: 'Documents' | 'Review queue'; items: Header[]; loading: boolean; canImport: boolean
  onImport: () => void; onDrop: (files: File[]) => void; onSample: () => void; onOpen: (id: string) => void
  onDelete: (item: Header) => void;
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [dragging, setDragging] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const isQueue = view === 'Review queue'
  const scoped = isQueue ? items.filter(item => !!(item.review?.pending || item.review?.unresolved)) : items
  const visible = scoped.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  if (sort === 'name') visible.sort((a,b) => a.name.localeCompare(b.name))
  if (sort === 'pending') visible.sort((a,b) => (b.review?.pending ?? 0) - (a.review?.pending ?? 0))
  const selected = visible.find(item => item.id === selectedId) ?? visible[0]
  const showPreview = !!selected || (!isQueue && !items.length && !loading && !query.trim())
  return <div className="library library-workbench" onDragOver={event => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragging(canImport)
  }} onDragLeave={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
  }} onDrop={event => {
    event.preventDefault()
    setDragging(false)
    if (canImport) onDrop(Array.from(event.dataTransfer.files))
  }}>
    <div className="library-index">
      <div className="page-heading">
        <div><Heading level={1} weight="bold">{isQueue ? 'Review queue' : 'Workpapers'}</Heading>
          <p>{isQueue ? 'Documents with outstanding findings.' : 'PDFs and review decisions are stored in this browser.'}</p></div>
        <Button variant="primary" size="md" label="Import documents" icon={<Plus size={16}/>} onClick={onImport} isDisabled={!canImport}/>
      </div>
    <Card padding={0} className={'surface document-list' + (dragging ? ' dragging' : '')} aria-labelledby="document-list-heading">
      <div className="list-header">
        <div className="list-title"><h2 id="document-list-heading">{isQueue ? 'Pending documents' : 'All documents'}</h2><Badge label={scoped.length + (scoped.length === 1 ? ' document' : ' documents')}/></div>
        <div className="list-controls">
          <TextInput label="Filter documents" placeholder="Search documents…" startIcon={<Search size={15}/>} isLabelHidden hasClear value={query} onChange={setQuery}/>
          <DropdownMenu alignment="end" button={{label:'Sort documents', variant:'secondary', icon:<ArrowDown size={15}/>, isIconOnly:true}}
            items={[
              {label:'Newest first', endContent:sort === 'recent' ? <CheckCheck size={15}/> : undefined, onClick:() => setSort('recent')},
              {label:'Document name', endContent:sort === 'name' ? <CheckCheck size={15}/> : undefined, onClick:() => setSort('name')},
              {label:'Most findings to review', endContent:sort === 'pending' ? <CheckCheck size={15}/> : undefined, onClick:() => setSort('pending')},
            ]}/>
        </div>
      </div>
        <Table className="data-table library-table" density="compact" hasHover aria-labelledby="document-list-heading">
          <TableHeader><TableRow><TableHeaderCell scope="col">Document name</TableHeaderCell><TableHeaderCell scope="col">Review status</TableHeaderCell><TableHeaderCell scope="col" className="number">Verified</TableHeaderCell><TableHeaderCell scope="col" aria-label="Actions"/></TableRow></TableHeader>
          <TableBody>{visible.map(item => <TableRow key={item.id} className={item.id === selected?.id ? 'selected-workpaper' : undefined}>
            <TableCell><button className="document-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === selected?.id}><span className="file-icon"><FileText size={18}/></span><span><strong>{item.name}</strong><small>{item.pages} {item.pages === 1 ? 'page' : 'pages'}</small></span></button></TableCell>
            <TableCell><Badge variant={item.review?.pending || item.review?.unresolved ? 'warning' : item.review?.total ? 'success' : 'neutral'}
              label={item.review?.pending || item.review?.unresolved ? [item.review.pending ? item.review.pending+' to review' : '',item.review.unresolved ? item.review.unresolved+' unresolved' : ''].filter(Boolean).join(' · ') : item.review?.total ? 'Queue complete' : 'No findings'}/></TableCell>
            <TableCell className="number">{item.count}</TableCell>
            <TableCell><DropdownMenu alignment="end" button={{label:`Actions for ${item.name}`, icon:<MoreHorizontal size={18}/>, variant:'ghost', isIconOnly:true}}
              items={[{label:'Open document', icon:<ArrowRight size={16}/>, onClick:() => onOpen(item.id)},
                {label:'Delete document', icon:<Trash2 size={16}/>, variant:'destructive', onClick:() => onDelete(item)}]}/></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      {!visible.length && <div className="empty">
        <EmptyState
          title={loading ? 'Loading documents…' : dragging ? 'Drop to import' : query.trim() ? 'No matching documents' : isQueue ? 'No findings to review' : 'Your library is empty'}
          description={loading ? undefined : query.trim() ? 'Try another filename.' : isQueue ? 'New findings appear here when you import a document.' : 'Drop PDF files here or browse to add them. Folio backups are also supported.'}
          icon={isQueue ? <CheckCheck size={30}/> : <FolderOpen size={30}/>}
          actions={!scoped.length && !isQueue && !query.trim() && !loading ? <>
            <Button label="Browse files" icon={<Upload size={16}/>} isDisabled={!canImport} onClick={onImport}/>
          </> : undefined}/>
      </div>}
    </Card>
    </div>
    {showPreview && <Suspense fallback={<aside className="library-preview"><div className="preview-loading" role="status">Opening preview…</div></aside>}>
      <LibraryPreview key={selected?.id ?? 'sample'} item={selected} sampleName={sampleName} disabled={!canImport}
        onOpen={selected ? () => onOpen(selected.id) : onSample}/>
    </Suspense>}
  </div>
}

type Entry = {id: string; document: string; figure: Figure}
function Register({items, loading, onOpen, onBrowse}: {
  items: Header[]; loading: boolean; onOpen: (id: string, figure: string) => void; onBrowse: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [reading, setReading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function readRegister() {
      setReading(true)
      setError('')
      const next: Entry[] = []
      for (const item of items) {
        if (!active) return
        if (!item.count) continue
        const doc = await get(item.id)
        if (!doc || doc.sample) continue
        for (const figure of doc.figures) next.push({id: doc.id, document:doc.name, figure})
      }
      if (active) setEntries(next.sort((a,b) => b.figure.saved.localeCompare(a.figure.saved)))
    }
    void readRegister().catch(() => {if (active) setError('Could not load the register. Reopen it to try again.')})
      .finally(() => {if (active) setReading(false)})
    return () => {active = false}
  }, [items])
  const needle = query.trim().toLowerCase()
  const visible = entries.filter(({id, document, figure}) => (!source || id === source) &&
    [document, figure.label, figure.amount, figure.unit, figure.period].some(value => value.toLowerCase().includes(needle)))
  const busy = loading || reading
  return <div className="library">
    <div className="page-heading"><div><Heading level={1} weight="bold">Figure register</Heading><p>Search verified figures across your documents and jump back to the source.</p></div>
      <Button label="Export CSV" variant="primary" size="lg" icon={<ArrowDownToLine size={16}/>} isDisabled={busy || !!error || !visible.length} onClick={() => downloadRegister(visible)}/>
    </div>
    <Card padding={0} className="surface" aria-labelledby="register-heading">
      <div className="list-header">
        <div className="list-title"><h2 id="register-heading">Verified figures</h2><Badge label={visible.length}/></div>
        <div className="list-controls">
          <TextInput label="Filter figures" placeholder="Search figures…" startIcon={<Search size={15}/>} isLabelHidden hasClear value={query} onChange={setQuery}/>
          <select aria-label="Source document" value={source} onChange={event => setSource(event.target.value)}>
            <option value="">All documents</option>{[...new Map(entries.map(entry => [entry.id, entry.document]))].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <Table className="data-table register-table" density="compact" hasHover aria-labelledby="register-heading">
        <TableHeader><TableRow><TableHeaderCell scope="col">Metric</TableHeaderCell><TableHeaderCell scope="col" className="number">Value</TableHeaderCell><TableHeaderCell scope="col">Unit</TableHeaderCell><TableHeaderCell scope="col">Period</TableHeaderCell><TableHeaderCell scope="col">Source</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{!busy && !error && visible.map(({id, document, figure}) => <TableRow key={id + figure.id}>
          <TableCell><button className="text-link" onClick={() => onOpen(id, figure.id)}>{figure.label}<ArrowUpRight size={14}/></button></TableCell>
          <TableCell className="number">{figure.amount}</TableCell><TableCell>{figure.unit || '—'}</TableCell><TableCell>{figure.period || '—'}</TableCell>
          <TableCell><span className="source-name">{document}</span><small>Page {figure.source.page}</small></TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {!visible.length && !error && <div className="empty">
        <EmptyState title={busy ? 'Loading figures…' : entries.length ? 'No matching figures' : 'No verified figures yet'}
          icon={<BookOpen size={30}/>}
          description={busy ? undefined : entries.length ? 'Adjust your search or source filter.' : 'Verify a finding in an imported document to add it to your register.'}
          actions={!busy && !entries.length ? <Button label="Browse documents" onClick={onBrowse}/> : undefined}/>
      </div>}
      {!!visible.length && <p className="table-caption">CSV exports the {visible.length} {visible.length === 1 ? 'figure' : 'figures'} shown, including source quotes and notes.</p>}
    </Card>
  </div>
}

createRoot(document.getElementById('root')!).render(<Theme theme={neutralTheme} mode="dark"><App/></Theme>)
