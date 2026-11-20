import {useEffect,useState} from 'react'
import {sourceHash,verifyHistory} from './audit'
import {StatusPill} from './QueueStatus'
import type {AuditEvent} from './review'
import type {Finding} from './findings'

type Ledger = {id:string; document?:string; history:AuditEvent[]}

export function useAuditIntegrity(ledgers:Ledger[]) {
  const [integrity,setIntegrity] = useState<boolean>()
  useEffect(()=>{
    let active = true
    setIntegrity(undefined)
    if (ledgers.some(ledger=>ledger.history.length)) {
      Promise.all(ledgers.map(ledger=>verifyHistory(ledger.history,sourceHash(ledger.id))))
        .then(results=>{if (active) setIntegrity(results.every(Boolean))})
        .catch(()=>{if (active) setIntegrity(false)})
    }
    return ()=>{active=false}
  },[ledgers])
  return integrity
}

export function IntegrityBadge({integrity}:{integrity:boolean|undefined}) {
  if (integrity===undefined) return null
  return <span className={'status-pill '+(integrity?'verified':'variance')}>
    {integrity ? 'SHA-256 Hash Chain Verified' : 'SHA-256 hash chain could not be verified'}
  </span>
}

export function ActivityTable({ledgers,query='',includeDocument=false}:{ledgers:Ledger[];query?:string;includeDocument?:boolean}) {
  const needle = query.trim().toLowerCase()
  const events = ledgers.flatMap(({id,document,history})=>history.map(event=>({id,document,event})))
    .filter(({document,event})=>!needle || [document,event.action,event.reviewer,event.reason,event.original?.label]
      .some(value=>value?.toLowerCase().includes(needle))).sort((a,b)=>b.event.saved.localeCompare(a.event.saved))
  if (!events.length) return <p className="register-empty">{needle ? 'No activity matches your filter.' : 'Review decisions and edits will appear here.'}</p>
  return <table className="workpaper-table"><thead><tr>{includeDocument && <th>Document</th>}<th>Action</th><th>Metric</th><th>Reviewer</th><th>Reason</th>
    <th>Before</th><th>After</th><th>Reviewed UTC</th></tr></thead>
    <tbody>{events.map(({id,document,event})=><tr key={id+event.id}>
      {includeDocument && <td>{document}</td>}
      <td className="audit-action">{event.action==='Verify figure' ? <StatusPill status="Verified"/> :
        event.action==='On hold' ? <StatusPill status="On Hold"/> :
        event.action==='Escalated' || event.action==='Excluded' ? <StatusPill status={event.action}/> :
        event.signoff ? <span className="status-pill signed">Sign-Off</span> : event.action}</td>
      <td className="audit-metric">{event.original?.source_label ?? event.original?.label ?? '—'}</td><td>{event.reviewer}</td><td>{event.reason || '—'}</td>
      <td>{event.ocr ? extracted(event.ocr.before) : describe(event.before)}</td><td>{event.ocr ? extracted(event.ocr.after) : describe(event.after)}</td>
      <td>{new Date(event.saved).toISOString().slice(0,19).replace('T',' ')}</td>
    </tr>)}</tbody></table>
}

function extracted(findings:Finding[]) {
  const detail = findings.map(finding=>[finding.label,finding.amount,finding.unit,finding.period].filter(Boolean).join(' ')).join(' · ')
  return <span title={detail}>{findings.length} extracted</span>
}

function describe(entry:AuditEvent['before']) {
  if (!entry) return '—'
  if ('amount' in entry) return [entry.label,entry.amount,entry.unit,entry.period,entry.note,entry.source.text].filter(Boolean).join(' · ')
  if ('reason' in entry) return [entry.reason ? entry.status ?? 'Excluded' : 'Pending',entry.code,entry.reason].filter(Boolean).join(' · ')
  return [entry.assignee || 'Unassigned',entry.priority].join(' · ')
}
