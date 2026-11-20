import {useEffect, useState} from 'react'
import {Dialog} from '@astryxdesign/core/Dialog'
import {DialogHeader} from '@astryxdesign/core/Dialog'
import {Button} from '@astryxdesign/core/Button'
import {appendHistory, genesis, sourceHash, verifyHistory} from './audit'
import {domainOrigin, ipOrigin, passkeysSupported, storedPasskey, verifySignOff} from './passkey'
import type {Preferences} from './preferences'
import type {RecordFile} from './register'

export function SealDialog({doc, isOpen, onOpenChange, settings, onSettings, onSealed}: {
  doc:RecordFile; isOpen:boolean; onOpenChange:(open:boolean)=>void; settings:Preferences; onSettings:(value:Preferences)=>void
  onSealed:(doc:RecordFile, message:string)=>void
}) {
  const [chain,setChain] = useState<{root:string; events:number; verified:boolean}>()
  const [reviewer,setReviewer] = useState(settings.reviewer)
  const [encrypt,setEncrypt] = useState(true)
  const [busy,setBusy] = useState(false)
  const [status,setStatus] = useState('')
  const [signatures,setSignatures] = useState<boolean[]>()
  const passkey = isOpen ? storedPasskey() : undefined
  useEffect(()=>{
    if (!isOpen) return
    let active = true
    setStatus('')
    setSignatures(undefined)
    setReviewer(settings.reviewer)
    void appendHistory(doc.history ?? [],sourceHash(doc.id)).then(async history=>{
      const verified = await verifyHistory(history,sourceHash(doc.id))
      if (active) setChain({root:history.at(-1)?.hash ?? genesis,events:history.length,verified})
    }).catch(()=>{if (active) setChain({root:genesis,events:0,verified:false})})
    return ()=>{active=false}
  },[isOpen,doc.history,doc.id])

  async function seal() {
    const name = reviewer.trim()
    if (!name) return setStatus('Enter the reviewer who is signing.')
    if (name!==settings.reviewer) onSettings({...settings,reviewer:name})
    setBusy(true)
    setStatus('Waiting for your passkey…')
    try {
      const {signAndSeal} = await import('./backup')
      const result = await signAndSeal(doc,name,settings.persistReviewer ? {name,saved:new Date().toISOString()} : undefined,encrypt)
      onSealed(result.doc,result.encrypted ? 'Signed and exported an encrypted .folio archive.' :
        result.prf || !encrypt ? 'Signed and exported the .folio archive.' : 'Signed and exported. This passkey does not support PRF, so the archive is not encrypted.')
      onOpenChange(false)
    } catch (error) {
      setStatus(error instanceof Error && error.name!=='NotAllowedError' ? error.message : 'The passkey request was cancelled or timed out.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    const signoffs = (doc.history ?? []).flatMap(event=>event.signoff ? [event.signoff] : [])
    setSignatures(await Promise.all(signoffs.map(signoff=>verifySignOff(signoff,null))))
  }

  const short = (hash:string) => hash.slice(0,6)+'…'+hash.slice(-4)
  return <Dialog isOpen={isOpen} onOpenChange={value=>{if (!busy) onOpenChange(value)}} width={520} aria-label="Sign and seal workpaper">
    <DialogHeader title="Sign & seal .folio" subtitle="Hardware passkey sign-off and encrypted backup"/>
    <div className="seal">
      <ol className="seal-steps">
        <li data-state={chain?.verified ? 'done' : chain ? 'failed' : undefined}>
          <span>Audit chain root</span>
          <b className="tabular">{chain ? `${short(chain.root)} · ${chain.events} ${chain.events===1 ? "event" : "events"} ${chain.verified ? 'verified' : 'failed verification'}` : 'Verifying…'}</b>
        </li>
        <li><span>Signature</span><b>{passkey ? 'Existing passkey · ES256 (P-256)' : 'A new passkey will be created · ES256 (P-256)'}</b></li>
        <li><span>Archive encryption</span><b>{!encrypt ? 'Off · signed only' : passkey && !passkey.prf ? 'Unavailable · this passkey has no PRF support' : 'AES-256-GCM · key derived with WebAuthn PRF'}</b></li>
      </ol>
      <label className="seal-field">Signing reviewer<input value={reviewer} maxLength={120} onChange={event=>setReviewer(event.target.value)} placeholder="Name or reviewer ID"/></label>
      <label className="switch-field"><input type="checkbox" checked={encrypt} onChange={event=>setEncrypt(event.target.checked)}/> Encrypt the archive with this passkey</label>
      <label className="switch-field"><input type="checkbox" checked={settings.persistReviewer}
        onChange={event=>onSettings({...settings,persistReviewer:event.target.checked})}/> Persist reviewer identity on restore</label>
      {!passkeysSupported() ? <p className="seal-note">This browser does not support passkeys.</p> : ipOrigin() &&
        <p className="seal-note" role="alert">Passkeys cannot be used on an IP address. Export a backup, then open Folio at <a href={domainOrigin()}>{domainOrigin()}</a> and import it there to sign.</p>}
      {signatures && <p className="seal-note" role="status">{signatures.length ? signatures.every(Boolean)
        ? `${signatures.length} passkey ${signatures.length===1 ? 'signature' : 'signatures'} verified.`
        : 'A passkey signature failed verification.' : 'This workpaper has not been signed yet.'}</p>}
      {status && <p className="seal-note" role="status">{status}</p>}
      <div className="seal-actions">
        <Button label="Verify signatures" onClick={()=>void verify()} isDisabled={busy}/>
        <Button variant="primary" label={encrypt ? 'Sign & export encrypted .folio' : 'Sign & export .folio'} isLoading={busy}
          isDisabled={!chain?.verified || !passkeysSupported() || ipOrigin()} onClick={()=>void seal()}/>
      </div>
    </div>
  </Dialog>
}

export function signedBy(doc:RecordFile) {
  return [...(doc.history ?? [])].reverse().find(event=>event.signoff)
}
