// Reviewer sign-off with a hardware passkey (WebAuthn, ES256 / P-256) and archive keys derived with the PRF extension.
export type SignOff = {
  credential_id:string; public_key:string; algorithm:'ES256'; signed_root:string; events:number
  authenticator_data:string; client_data_json:string; signature:string
}
export type Passkey = {credentialId:string; publicKey:string; prf:boolean; reviewer:string; created:string}

const storeKey = 'folio-passkeys'
const prfInfo = new TextEncoder().encode('folio-archive-aes-256-gcm-v1')

export const b64 = (bytes:ArrayBuffer|Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
  .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
export const unb64 = (value:string):Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0))
const hexBytes = (hex:string) => new Uint8Array((hex.match(/../g) ?? []).map(byte=>parseInt(byte,16)))
const random = (length:number) => crypto.getRandomValues(new Uint8Array(length) as Uint8Array<ArrayBuffer>)

export const passkeysSupported = () => typeof window!=='undefined' && !!window.PublicKeyCredential && !!navigator.credentials
// WebAuthn relying-party IDs must be domains, so passkeys are unavailable on IP-address origins such as 127.0.0.1.
export const ipOrigin = () => /^\d{1,3}(?:\.\d{1,3}){3}$|^\[/.test(location.hostname)
export const domainOrigin = () => location.protocol+'//localhost'+(location.port ? ':'+location.port : '')

export function storedPasskey():Passkey|undefined {
  try {return JSON.parse(localStorage.getItem(storeKey) ?? 'null') ?? undefined} catch {return undefined}
}

export async function registerPasskey(reviewer:string):Promise<Passkey> {
  const credential = await navigator.credentials.create({publicKey:{
    rp:{name:'Folio'},user:{id:random(16),name:reviewer,displayName:reviewer},challenge:random(32),
    pubKeyCredParams:[{type:'public-key',alg:-7}],timeout:120000,attestation:'none',
    authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
    extensions:{prf:{}} as AuthenticationExtensionsClientInputs,
  }}) as PublicKeyCredential | null
  if (!credential) throw Error('Passkey registration was cancelled.')
  const response = credential.response as AuthenticatorAttestationResponse
  const spki = response.getPublicKey()
  if (!spki || response.getPublicKeyAlgorithm()!==-7) throw Error('This authenticator did not return a P-256 signing key.')
  const prf = !!(credential.getClientExtensionResults() as {prf?:{enabled?:boolean}}).prf?.enabled
  const passkey = {credentialId:b64(credential.rawId),publicKey:b64(spki),prf,reviewer,created:new Date().toISOString()}
  localStorage.setItem(storeKey,JSON.stringify(passkey))
  return passkey
}

// One ceremony signs the audit root (as the WebAuthn challenge) and, when a salt is given, evaluates the PRF.
type Bytes = Uint8Array<ArrayBuffer>

export async function assert(credentialId:string, challenge:Bytes, salt?:Bytes) {
  const credential = await navigator.credentials.get({publicKey:{
    challenge,allowCredentials:[{type:'public-key',id:unb64(credentialId)}],userVerification:'required',timeout:120000,
    ...(salt ? {extensions:{prf:{eval:{first:salt}}} as AuthenticationExtensionsClientInputs} : {}),
  }}) as PublicKeyCredential | null
  if (!credential) throw Error('Passkey sign-in was cancelled.')
  const response = credential.response as AuthenticatorAssertionResponse
  const prf = (credential.getClientExtensionResults() as {prf?:{results?:{first?:BufferSource}}}).prf?.results?.first
  return {response,prf:prf ? new Uint8Array(prf instanceof ArrayBuffer ? prf : (prf as ArrayBufferView<ArrayBuffer>).buffer) : undefined}
}

export async function signRoot(passkey:Passkey, root:string, events:number, salt?:Bytes) {
  const {response,prf} = await assert(passkey.credentialId,hexBytes(root),salt)
  const signoff:SignOff = {credential_id:passkey.credentialId,public_key:passkey.publicKey,algorithm:'ES256',signed_root:root,events,
    authenticator_data:b64(response.authenticatorData),client_data_json:b64(response.clientDataJSON),signature:b64(response.signature)}
  if (!await verifySignOff(signoff)) throw Error('The passkey signature could not be verified.')
  return {signoff,prf}
}

// WebAuthn ES256 signatures are DER-encoded; WebCrypto expects the raw 64-byte r||s form.
function derToRaw(der:Uint8Array) {
  let offset = 2
  const read = () => {
    const length = der[offset+1]
    let value = der.slice(offset+2,offset+2+length)
    offset += 2+length
    while (value.length>32 && value[0]===0) value = value.slice(1)
    const padded = new Uint8Array(32)
    padded.set(value,32-value.length)
    return padded
  }
  if (der[0]!==0x30) throw Error('Invalid ECDSA signature.')
  const r = read(), s = read()
  return new Uint8Array([...r,...s])
}

export async function verifySignOff(signoff:SignOff, origin:string|null = location.origin) {
  try {
    const client = JSON.parse(new TextDecoder().decode(unb64(signoff.client_data_json)))
    if (client.type!=='webauthn.get' || client.challenge!==b64(hexBytes(signoff.signed_root)) || origin!==null && client.origin!==origin) return false
    const authenticator = unb64(signoff.authenticator_data)
    if (!(authenticator[32] & 0x01) || !(authenticator[32] & 0x04)) return false
    const key = await crypto.subtle.importKey('spki',unb64(signoff.public_key),{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256',unb64(signoff.client_data_json)))
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,derToRaw(unb64(signoff.signature)),new Uint8Array([...authenticator,...clientHash]))
  } catch {
    return false
  }
}

export async function archiveKey(prf:Bytes, salt:Bytes) {
  const material = await crypto.subtle.importKey('raw',prf,'HKDF',false,['deriveKey'])
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:prfInfo},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}

export const newSalt = () => random(32)
export const newIv = () => random(12)
