import {useEffect,useRef,useState} from 'react'
import {analyzeLines} from './findings'
import {ambiguousContext,createDraft} from './agentDraft'
import {cropEvidence} from './evidence'
import {tieOuts} from './tieout'
import type {Figure} from './register'
import {change,get,readRegister,type RecordFile} from './register'
import {findingKey,findingStatus,workpaperFindings} from './review'
import {reconciliation,variance} from './reconciliation'
import {resources,type WorkspaceTool} from './bridgeCatalog'
import type {Preferences} from './preferences'

export function useWorkspaceBridge(activeId:string|undefined, settings:Preferences, onChange:(doc:RecordFile)=>void) {
  const current = useRef({activeId,settings,onChange})
  current.current = {activeId,settings,onChange}
  const [connected,setConnected] = useState(false)
  useEffect(()=>{
    if (!settings.bridge.enabled || !['127.0.0.1','localhost'].includes(location.hostname)) return
    let socket:WebSocket
    let stopped = false
    let retry = 0
    const publish = () => {
      if (socket?.readyState===WebSocket.OPEN) {
        socket.send(JSON.stringify({type:'workspace',consent:current.current.settings.bridge.tools,focused:document.hasFocus()}))
      }
    }
    async function invoke(operation:string,args:Record<string,unknown>,agent:string) {
      const {activeId,settings,onChange} = current.current
      if (!settings.bridge.enabled) throw Error('Workspace sharing is disabled.')
      if (!resources.some(resource=>resource.uri===operation) && !settings.bridge.tools[operation as WorkspaceTool]) throw Error('Tool consent is disabled.')
      if (operation===resources[2].uri || operation==='query_figure_register') {
        const query = typeof args.query==='string' ? args.query.trim().toLowerCase() : ''
        const entries = await readRegister(query)
        const offset = typeof args.offset==='number' && Number.isSafeInteger(args.offset) ? Math.max(0,args.offset) : 0
        const limit = typeof args.limit==='number' && Number.isSafeInteger(args.limit) ? Math.max(1,Math.min(100,args.limit)) : 100
        return {entries:entries.slice(offset,offset+limit),total:entries.length,next_offset:entries.length>offset+limit ? offset+limit : null}
      }
      const doc = activeId && await get(activeId)
      if (!doc) throw Error('Open a workpaper in Folio.')
      const analysis = analyzeLines(doc.lines)
      const findings = workpaperFindings(analysis.items,doc.figures,doc.exclusions,doc.assignments)
      if (operation===resources[0].uri) return {workpaper_id:doc.id,document:doc.name,findings:findings.flatMap(finding=>{
        const status = findingStatus(finding,doc.figures,doc.exclusions)
        return status==='Verified' || status==='Excluded' ? [] : [{finding_id:findingKey(finding),status,finding}]
      })}
      if (operation===resources[1].uri || operation==='explain_reconciliation_variance') {
        return {workpaper_id:doc.id,variances:reconciliation(analysis).flatMap(rule=>{
          if (args.finding_id && ![rule.total,...rule.operands.map(item=>item.finding)].some(item=>findingKey(item)===args.finding_id)) return []
          const computed = variance(rule,doc.figures)
          return computed?.failed ? [{...rule,...computed}] : []
        })}
      }
      if (operation==='run_workpaper_tieout') {
        const arithmetic = reconciliation(analysis).map(rule=>{
          const computed = variance(rule,doc.figures)
          return {name:rule.name,period:rule.total.period,unit:rule.total.unit,status:computed ? computed.failed ? 'variance' : 'reconciles' : 'needs_review',
            difference:computed?.difference ?? null,equation:computed?.equation ?? null,total_finding_id:findingKey(rule.total),page:rule.total.source.page}
        })
        const ties = tieOuts(findings,doc.figures,doc.exclusions).map(tie=>({metric:tie.metric,period:tie.period,unit:tie.unit,
          status:tie.failed ? 'variance' : 'ties',difference:tie.difference,
          sources:[tie.a,tie.b].map(side=>({finding_id:findingKey(side.finding),page:side.page,amount:side.amount,unit:side.unit,quote:side.finding.source.text}))}))
        const onlyVariances = args.only_variances===true
        return {workpaper_id:doc.id,document:doc.name,pages:doc.pages,
          arithmetic:onlyVariances ? arithmetic.filter(item=>item.status==='variance') : arithmetic,
          tie_outs:onlyVariances ? ties.filter(item=>item.status==='variance') : ties,
          variances:arithmetic.filter(item=>item.status==='variance').length+ties.filter(item=>item.status==='variance').length}
      }
      if (operation==='review_finding_draft') {
        const reviewer = settings.reviewer.trim()
        if (!reviewer) throw Error('Set a reviewer name in Folio before approving from the card.')
        const proposal = Object.values(doc.drafts ?? {}).find(item=>item.id===args.draft_id)
        if (!proposal || !['approve','reject'].includes(String(args.decision))) throw Error('This draft is no longer awaiting review.')
        const finding = findings.find(item=>findingKey(item)===proposal.findingId)
        if (!finding) throw Error('Finding is unavailable.')
        const approve = args.decision==='approve'
        if (approve && (proposal.run!==finding.source.extraction_run_id || proposal.run!==doc.extractionRuns?.[finding.source.page] ||
          proposal.baseDecision!==doc.exclusions?.[proposal.findingId]?.saved)) throw Error('The source changed. Reject this draft and request a new proposal.')
        const updated = await change(doc.id,prior=>{
          if (!prior || prior.drafts?.[proposal.findingId]?.id!==proposal.id) throw Error('This draft is no longer awaiting review.')
          const saved = new Date().toISOString()
          const drafts = {...prior.drafts}
          delete drafts[proposal.findingId]
          const reason = `${approve ? 'Approved' : 'Rejected'} in the MCP Apps verification card (${agent})`
          if (!approve) return {...prior,drafts,history:[...(prior.history ?? []),{id:crypto.randomUUID(),action:'Reject draft',reviewer,saved,reason,original:finding,draft:proposal}]}
          const after:Figure = {id:crypto.randomUUID(),label:proposal.changes.canonicalMetric?.trim() ?? finding.canonical_metric ?? finding.label,
            verbatimLabel:finding.source_label ?? finding.label,amount:proposal.changes.amount ?? finding.amount,unit:proposal.changes.unit ?? finding.unit,
            period:proposal.changes.period ?? finding.period,note:proposal.changes.note ?? '',source:finding.source,saved,original:finding,
            findingKey:proposal.findingId,changeReason:proposal.rationale,reviewer}
          const exclusions = {...prior.exclusions}
          delete exclusions[proposal.findingId]
          return {...prior,drafts,exclusions,figures:[...prior.figures,after],history:[...(prior.history ?? []),
            {id:crypto.randomUUID(),action:'Verify figure',reviewer,saved,reason,original:finding,after,draft:proposal}]}
        })
        if (updated) onChange(updated)
        return {draft_id:proposal.id,status:approve ? 'Verified' : 'Rejected'}
      }
      if (operation==='propose_finding_edit') {
        if (args.workpaper_id!==doc.id || current.current.activeId!==doc.id) throw Error('The requested workpaper is no longer active.')
        const finding = findings.find(item=>findingKey(item)===args.finding_id)
        if (!finding) throw Error('Finding is unavailable.')
        const missing = ambiguousContext(finding).filter(field=>{
          const value = (args.context as Record<string,unknown> | undefined)?.[field]
          return typeof value!=='string' || !value.trim()
        })
        if (missing.length) return {input_required:{fields:missing,
          message:`Confirm the ${missing.join(' and ')} for “${finding.source_label ?? finding.label}” (${finding.amount}) on page ${finding.source.page} before Folio stages this draft.`,
          suggestions:{unit:finding.unit || undefined,period:finding.period || undefined}}}
        const draft = createDraft(doc,finding,args,agent)
        const updated = await change(doc.id,prior=>{
          if (!prior || prior.revision!==doc.revision || current.current.activeId!==doc.id ||
            !current.current.settings.bridge.enabled || !current.current.settings.bridge.tools.propose_finding_edit) throw Error('Workspace changed. Read the current finding and retry.')
          if (prior.drafts?.[draft.findingId]) throw Error('A draft is already awaiting review for this finding.')
          return {...prior,drafts:{...prior.drafts,[draft.findingId]:draft},
            history:[...(prior.history ?? []),{id:crypto.randomUUID(),action:'Stage draft',reviewer:agent,
              saved:draft.created,reason:draft.rationale,original:finding,draft}]}
        })
        if (updated) onChange(updated)
        const evidence = await cropEvidence(doc,finding.source.page,finding.source.box).catch(()=>undefined)
        return {draft_id:draft.id,status:'Draft',changes:draft.changes,rationale:draft.rationale,
          before:{amount:finding.amount,canonicalMetric:finding.canonical_metric ?? finding.label,unit:finding.unit,period:finding.period},
          finding:{finding_id:draft.findingId,label:finding.source_label ?? finding.label,source:finding.source.text,page:finding.source.page},
          evidence:{page:finding.source.page,box:finding.source.box,...(evidence ? {image:evidence} : {})}}
      }
      throw Error('Unknown workspace operation.')
    }
    function connect() {
      socket = new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/local/workspace')
      socket.onopen = ()=>{setConnected(true);publish()}
      socket.onclose = ()=>{
        if (stopped) return
        setConnected(false)
        retry = window.setTimeout(connect,2000)
      }
      socket.onmessage = async ({data})=>{
        const {id,operation,args,agent} = JSON.parse(data)
        const connection = socket
        try {
          const result = await invoke(operation,args,agent)
          if (connection.readyState===WebSocket.OPEN) connection.send(JSON.stringify({id,result}))
        } catch (error) {
          if (connection.readyState===WebSocket.OPEN) connection.send(JSON.stringify({id,error:error instanceof Error ? error.message : 'Workspace request failed.'}))
        }
      }
    }
    connect()
    window.addEventListener('focus',publish)
    window.addEventListener('folio-bridge-settings',publish)
    return ()=>{
      stopped = true
      clearTimeout(retry)
      socket.close()
      setConnected(false)
      window.removeEventListener('focus',publish)
      window.removeEventListener('folio-bridge-settings',publish)
    }
  },[settings.bridge.enabled])
  useEffect(()=>{window.dispatchEvent(new Event('folio-bridge-settings'))},[settings.bridge.tools])
  return connected
}
