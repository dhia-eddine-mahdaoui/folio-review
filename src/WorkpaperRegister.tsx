import {useMemo,useState} from 'react'
import {Button} from '@astryxdesign/core/Button'
import {ArrowDownToLine, Archive, ArrowUpRight, FileSpreadsheet, History, List} from 'lucide-react'
import {type Figure, type RecordFile} from './register'
import {formattedAmount,sourceScale} from './amount'
import {ActivityTable,IntegrityBadge,useAuditIntegrity} from './ActivityTable'

type Sort = 'label' | 'amount' | 'period' | 'saved'
const columns: {key:Sort; label:string}[] = [
  {key:'label', label:'Canonical metric'}, {key:'amount', label:'Verified value'},
  {key:'period', label:'Period'}, {key:'saved', label:'Reviewed UTC'},
]

export function WorkpaperRegister({doc, onOpen, onCsv, onExport}: {
  doc:RecordFile; onOpen:(figure:Figure)=>void; onCsv:(figures:Figure[])=>void; onExport:(format:'Excel'|'Folio',figures?:Figure[])=>void
}) {
  const [activity,setActivity] = useState(false)
  const ledgers = useMemo(()=>activity ? [{id:doc.id,history:doc.history ?? []}] : [],[activity,doc.id,doc.history])
  const integrity = useAuditIntegrity(ledgers)
  const [query,setQuery] = useState('')
  const [sort,setSort] = useState<{key:Sort; ascending:boolean}>({key:'saved',ascending:false})
  const needle = query.trim().toLowerCase()
  const visible = doc.figures.filter(figure => [figure.label,figure.amount,figure.unit,figure.period,figure.note,figure.source.text,figure.reviewer ?? '']
    .some(value => value.toLowerCase().includes(needle))).sort((a,b) => (sort.ascending ? 1 : -1) *
      (sort.key==='amount' ? compareAmounts(a.amount,b.amount) : a[sort.key].localeCompare(b[sort.key],undefined,{numeric:true})))
  const events = doc.history ?? []
  return <section className="workpaper-register" aria-labelledby="workpaper-register-heading">
    <div className="register-bar">
      <h2 id="workpaper-register-heading">{activity ? 'Activity history' : 'Figure register'} <span>{activity ? events.length : visible.length}</span></h2>
      <Button size="sm" variant="ghost" label={activity ? 'Figure register' : 'Activity history'}
        icon={activity ? <List size={14}/> : <History size={14}/>} onClick={() => setActivity(!activity)}/>
      {activity && <IntegrityBadge integrity={integrity}/>}
      <div className="grow"/>
      {!activity && <input aria-label="Filter workpaper figures" placeholder="Filter figures…" value={query} onChange={event=>setQuery(event.target.value)}/>}
      <Button size="sm" label="CSV" icon={<ArrowDownToLine size={14}/>} isDisabled={!visible.length} onClick={() => onCsv(visible)}/>
      <Button size="sm" label="Excel" icon={<FileSpreadsheet size={14}/>} onClick={() => onExport('Excel',visible)}/>
      <Button size="sm" label="Backup" icon={<Archive size={14}/>} onClick={() => onExport('Folio')}/>
    </div>
    <div className="register-scroll">
      {activity ? <ActivityTable ledgers={ledgers}/> :
        <table className="workpaper-table"><thead><tr>
          <th>Document</th>
          {columns.slice(0,1).map(column=>header(column))}
          <th>Verbatim label</th><th>Original value</th>
          {columns.slice(1,3).map(column=>header(column))}
          <th>Normalized</th><th>Status</th><th>Reviewer notes</th><th>Source citation</th>{header(columns[3])}
        </tr></thead><tbody>
          {visible.map(figure=><tr key={figure.id}>
            <td title={doc.name}>{doc.name}</td><td><button type="button" onClick={()=>onOpen(figure)}>{figure.label}<ArrowUpRight size={13}/></button></td>
            <td>{figure.verbatimLabel ?? figure.original?.source_label ?? figure.original?.label ?? '—'}</td><td className="tabular">{figure.original?.amount ?? '—'}</td><td className="tabular">{sourceScale(figure).amount} <small>{sourceScale(figure).unit}</small></td>
            <td>{figure.period || '—'}</td><td className="tabular">{formattedAmount(figure.amount,figure.unit)}</td><td><span className="status-pill verified">Verified</span></td>
            <td title={figure.note}>{figure.note || '—'}</td><td title={figure.source.text}>p. {figure.source.page} · {figure.source.text}</td>
            <td title={figure.reviewer}>{figure.saved.slice(0,10)}</td>
          </tr>)}
        </tbody></table>}
      {!activity && !visible.length && <p className="register-empty">{needle ? 'No figures match your filter.' : 'Verified figures will appear here as you save them.'}</p>}
    </div>
  </section>

  function header(column: typeof columns[number]) {
    return <th key={column.key} aria-sort={sort.key === column.key ? sort.ascending ? 'ascending' : 'descending' : 'none'}>
      <button type="button" onClick={() => setSort({key:column.key,ascending:sort.key !== column.key || !sort.ascending})}>
        {column.label}{sort.key === column.key && <span aria-hidden="true">{sort.ascending ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  }
}

function compareAmounts(a:string,b:string) {
  const precision = Math.max(a.split('.')[1]?.length ?? 0,b.split('.')[1]?.length ?? 0)
  const integer = (value:string) => {
    const [whole,fraction=''] = value.split('.')
    return BigInt(whole+fraction.padEnd(precision,'0'))
  }
  const difference = integer(a)-integer(b)
  return difference<0n ? -1 : difference>0n ? 1 : 0
}
