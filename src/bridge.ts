import {useEffect,useRef,useState} from 'react'
import {analyzeLines} from './findings'
import {createDraft} from './agentDraft'
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
      if (operation==='propose_finding_edit') {
        if (args.workpaper_id!==doc.id || current.current.activeId!==doc.id) throw Error('The requested workpaper is no longer active.')
        const finding = findings.find(item=>findingKey(item)===args.finding_id)
        if (!finding) throw Error('Finding is unavailable.')
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
        return {draft_id:draft.id,status:'Draft'}
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
