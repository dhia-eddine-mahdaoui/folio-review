import {statuses, type Status} from './review'

export function StatusPill({status, count}:{status:Status;count?:number}) {
  const tone = status==='Verified' ? 'verified' : status==='Pending' ? 'neutral' : status==='Excluded' ? 'excluded' : 'review'
  return <span className={'status-pill '+tone}>{count===undefined ? status : count+' '+status}</span>
}

export function QueueStatus({counts}:{counts:Record<Status,number>}) {
  return <div className="queue-status" aria-label="Finding counts">
    {statuses.map(status=><StatusPill key={status} status={status} count={counts[status]}/>)}
  </div>
}
