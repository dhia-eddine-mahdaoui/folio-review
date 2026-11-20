import {useEffect,useState} from 'react'
import {Button} from '@astryxdesign/core/Button'
import {Check, Plug} from 'lucide-react'
import {storePreferences,type Preferences} from './preferences'

type Agent = {name:string; detected:boolean; installed:boolean; managed:boolean; skill:string|null}
type LocalAgents = {template:string; installedRuntime:boolean; agents:Agent[]}
const endpoint = '/api/local/agents'
const names = ['Codex','Claude Code','Gemini CLI','Cursor']
const customHeading = '\n## Workspace instructions\n'

export function AgentHub({settings,onSettings}:{settings:Preferences;onSettings:(value:Preferences)=>void}) {
  const [local,setLocal] = useState<LocalAgents>()
  const [target,setTarget] = useState(names[0])
  const [instructions,setInstructions] = useState('')
  const [skillStatus,setSkillStatus] = useState('')
  const [connection,setConnection] = useState('')
  const [busy,setBusy] = useState(false)
  const [saving,setSaving] = useState(false)
  const [message,setMessage] = useState('')
  const [mode,setMode] = useState(settings.ocr)
  const agent = local?.agents.find(agent=>agent.name===target)
  const skill = agent?.skill ?? local?.template
  useEffect(()=>{
    let active = true
    void fetch(endpoint).then(async response=>{
      if(!response.ok)throw Error()
      const result = await response.json() as LocalAgents
      if(!Array.isArray(result.agents))throw Error()
      if(active)setLocal(result)
    }).catch(()=>{if(active)setSkillStatus('Local skill management is available in Folio Desktop.')})
    return ()=>{active=false}
  },[])
  useEffect(()=>{
    setInstructions(agent?.skill?.split(customHeading)[1]?.trim() ?? '')
  },[agent])

  async function test() {
    setBusy(true)
    setConnection('Connecting to Folio MCP…')
    const request = async (method:string,id:number,params?:object) => {
      const response = await fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
        body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(8000)})
      if(!response.ok)throw Error()
      const payload = await response.json()
      if(payload.error || !payload.result)throw Error()
      return payload.result
    }
    try {
      const initialized = await request('initialize',1,{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Folio workspace',version:'1'}})
      const result = await request('tools/list',2)
      setConnection(`${initialized.serverInfo.name} · ${result.tools.map((tool:{name:string})=>tool.name).join(', ')}`)
    } catch {
      setConnection('Folio MCP could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  async function updateSkill(action:'install'|'remove') {
    setSaving(true)
    setSkillStatus('')
    try{
      const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,name:target,instructions})})
      const result = await response.json()
      if(!response.ok)throw Error(result.error)
      setLocal(result)
      setSkillStatus(action==='install' ? target+' skill saved. Start a new agent session to load it.' : target+' skill removed.')
    }catch(error){
      setSkillStatus(error instanceof Error ? error.message : 'Could not update the skill.')
    }finally{
      setSaving(false)
    }
  }

  return <div className="hub">
    <div className="page-heading"><div><h1>Agent MCP &amp; Skill</h1><p>Manage agent connections, reviewer preferences, and OCR.</p></div></div>
    <div className="hub-grid">
      <section className="hub-card">
        <h2>Folio MCP</h2>
        <label>Endpoint<input readOnly value={location.origin+'/mcp'} onFocus={event=>event.target.select()}/></label>
        <p>Add this URL as an HTTP MCP server in your agent client.</p>
        <Button label="Test connection" icon={<Plug size={16}/>} onClick={()=>void test()} isLoading={busy}/>
        {connection && <p role="status">{connection}</p>}
      </section>
      <section className="hub-card">
        <h2>Reviewer and OCR settings</h2>
        <form className="entry" onSubmit={event=>{
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const value = String(data.get('endpoint') ?? '').trim()
          try {
            let url = ''
            if(mode==='hosted'){
              const parsed = new URL(value)
              if(parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.hash)throw Error()
              url = parsed.href
            }
            const updated:Preferences = {reviewer:String(data.get('reviewer') ?? '').trim(),ocr:mode,endpoint:url,
              reasons:[...new Set(String(data.get('reasons') ?? '').split('\n').map(reason=>reason.trim()).filter(Boolean))]}
            if(!updated.reasons.length){setMessage('Enter at least one reason code.');return}
            storePreferences(updated)
            onSettings(updated)
            setMessage('Workspace preferences saved.')
          } catch {
            setMessage(mode==='hosted' ? 'Enter a valid HTTPS OCR endpoint without credentials or a fragment.' : 'Could not save workspace preferences.')
          }
        }}>
          <label>Default reviewer ID<input name="reviewer" defaultValue={settings.reviewer} maxLength={120} placeholder="Name or team ID"/></label>
          <label>Exception reason codes <textarea name="reasons" defaultValue={settings.reasons.join('\n')} maxLength={2000} rows={5} required/></label>
          <label>Manual OCR engine<select name="engine" aria-label="Manual OCR engine" value={mode} onChange={event=>setMode(event.target.value as Preferences['ocr'])}>
            <option value="local">Local English OCR</option><option value="hosted">Hosted OCR endpoint</option>
          </select></label>
          {mode==='hosted' && <><label>Hosted OCR endpoint<input name="endpoint" type="url" defaultValue={settings.endpoint} placeholder="https://…" required/></label>
            <p>OCR retry and unreadable lasso selections send a PNG to this endpoint. Imports use local OCR. The endpoint must allow this origin and return JSON with a <code>lines</code> array of <code>text</code>, normalized <code>box</code> and optional <code>confidence</code> values from 0 to 100.</p></>}
          <div><Button type="submit" label="Save preferences" icon={<Check size={16}/>} variant="primary"/></div>
          {message && <p role="status">{message}</p>}
        </form>
      </section>
      <section className="hub-card skills-card">
        <h2>Agent skills</h2>
        <label>Agent profile<select aria-label="Agent profile" value={target} disabled={saving} onChange={event=>{setTarget(event.target.value);setSkillStatus('')}}>
          {names.map(name=><option key={name}>{name}</option>)}</select></label>
        {agent && <p>{agent.installed ? agent.managed ? 'Installed and managed by Folio' : 'Existing skill on this device' : agent.detected ? 'Profile detected · skill available' : 'Agent profile not detected'}</p>}
        {skill && <details><summary>View skill instructions</summary><pre>{skill}</pre></details>}
        {agent?.detected && local?.installedRuntime && (!agent.installed || agent.managed) && <>
          <label>Workspace instructions<textarea value={instructions} onChange={event=>setInstructions(event.target.value)} maxLength={4000} rows={4} placeholder="Optional instructions appended to the Folio skill"/></label>
          <div className="reader-tools"><Button label={agent.installed ? 'Update skill' : 'Install skill'} onClick={()=>void updateSkill('install')} isDisabled={saving}/>
            {agent.managed && <Button label="Remove skill" variant="ghost" onClick={()=>void updateSkill('remove')} isDisabled={saving}/>}</div>
        </>}
        {(skillStatus || local && !local.installedRuntime) && <p role="status">{skillStatus || 'Install Folio Desktop to manage this device’s agent skills.'}</p>}
      </section>
    </div>
  </div>
}
