import {spawn} from 'node:child_process'
import {boundedBody} from './service.js'

function docling(pdf) {
  return new Promise((resolve,reject)=>{
    const child = spawn(process.env.FOLIO_DOCLING_PYTHON,['folio/docling_layout.py'],{
      stdio:['pipe','pipe','ignore'],timeout:180000,windowsHide:true,
    })
    const chunks = []
    let size = 0
    child.stdout.on('data',chunk=>{
      size+=chunk.length
      if (size>32*1024*1024) child.kill()
      else chunks.push(chunk)
    })
    child.on('error',reject)
    child.stdin.on('error',reject)
    child.on('close',code=>{
      if (code!==0) return reject(Error('Docling extraction failed. Check the local Python environment and model files.'))
      try {resolve(JSON.parse(Buffer.concat(chunks).toString()))} catch {reject(Error('Docling returned invalid layout data.'))}
    })
    child.stdin.end(pdf)
  })
}

export function readMistralBlocks(data) {
  const page = data.pages?.[0]
  const {width,height} = page?.dimensions ?? {}
  if (!(width>0 && height>0) || !Array.isArray(page?.blocks)) throw Error('Mistral did not return page geometry.')
  const pageConfidence = page.confidence_scores?.minimum_page_confidence_score
  const words = page.confidence_scores?.word_confidence_scores ?? []
  const confidence = value=>Math.max(0,Math.min(100,value<=1 ? value*100 : value))
  let offset = 0
  return page.blocks.flatMap(block=>{
    if (typeof block.content!=='string' || !block.content.trim() || block.type==='image') return []
    const box = [block.top_left_x/width,block.top_left_y/height,block.bottom_right_x/width,block.bottom_right_y/height]
    if (!box.every(value=>Number.isFinite(value) && value>=0 && value<=1) || box[0]>=box[2] || box[1]>=box[3]) return []
    const at = typeof page.markdown==='string' ? page.markdown.indexOf(block.content,offset) : -1
    if (at>=0) offset = at+block.content.length
    const wordConfidence = at<0 ? [] : words.filter(word=>Number.isInteger(word.start_index) &&
      word.start_index>=at && word.start_index<offset && typeof word.text==='string' && Number.isFinite(word.confidence))
      .map(word=>({text:word.text,confidence:confidence(word.confidence)}))
    const score = wordConfidence.length ? Math.min(...wordConfidence.map(word=>word.confidence)) :
      block.confidence_scores?.minimum_content_confidence_score ?? pageConfidence
    return [{text:block.content.trim().replace(/^(?:#+|[-*])\s+/,'').replace(/\*\*/g,''),
      box,block_type:block.type,confidence:wordConfidence.length ? score : Number.isFinite(score) ? confidence(score) : undefined,
      ...(wordConfidence.length ? {wordConfidence} : {})}]
  })
}

async function mistral(png,key) {
  const response = await fetch('https://api.mistral.ai/v1/ocr',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},redirect:'error',
    signal:AbortSignal.timeout(40000),
    body:JSON.stringify({model:'mistral-ocr-4-1',document:{type:'image_url',image_url:'data:image/png;base64,'+Buffer.from(png).toString('base64')},
      include_blocks:true,confidence_scores_granularity:'word'}),
  })
  if (!response.ok) throw Error('Mistral OCR returned HTTP '+response.status+'.')
  return {lines:readMistralBlocks(await response.json())}
}

export async function extractionEngine(request) {
  const {pathname,origin} = new URL(request.url)
  if (!['/api/local/layout','/api/local/mistral-ocr'].includes(pathname)) return
  if (request.method!=='POST' || request.headers.get('Origin')!==origin) return Response.json({error:'Origin or method rejected.'},{status:403})
  const layout = pathname.endsWith('/layout')
  const type = layout ? 'application/pdf' : 'image/png'
  if (request.headers.get('Content-Type')!==type) return Response.json({error:'Expected '+type},{status:415})
  const {FOLIO_DOCLING_PYTHON,FOLIO_DOCLING_MODELS,MISTRAL_API_KEY} = process.env
  if (layout ? !FOLIO_DOCLING_PYTHON || !FOLIO_DOCLING_MODELS : !MISTRAL_API_KEY) {
    return Response.json({error:layout ? 'Set FOLIO_DOCLING_PYTHON and FOLIO_DOCLING_MODELS in Folio Desktop.' :
      'Set MISTRAL_API_KEY for the local Folio service.'},{status:503})
  }
  try {
    const bytes = await boundedBody(request,(layout ? 50 : 12)*1024*1024)
    return Response.json(layout ? await docling(bytes) : await mistral(bytes,MISTRAL_API_KEY))
  } catch (error) {
    return Response.json({error:error.message},{status:422})
  }
}
