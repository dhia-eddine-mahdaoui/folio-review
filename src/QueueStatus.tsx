import {statuses, type Status} from './review'

const tones:Record<Status,string> = {Pending:'pending','On Hold':'hold',Escalated:'escalated',Verified:'verified',Excluded:'excluded'}

export function StatusPill({status, count}:{status:Status;count?:number}) {
  return <span className={'status-pill '+tones[status]} data-empty={count===0 || undefined}>{count===undefined ? status : count+' '+status}</span>
}

export function QueueStatus({counts}:{counts:Record<Status,number>}) {
  return <div className="queue-status" aria-label="Finding counts">
    {statuses.map(status=><StatusPill key={status} status={status} count={counts[status]}/>)}
  </div>
}

export const unresolvedCount = (counts:Record<Status,number>) => counts.Pending+counts['On Hold']+counts.Escalated
