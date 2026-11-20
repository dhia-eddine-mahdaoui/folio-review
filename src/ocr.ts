import { createWorker, OEM } from 'tesseract.js'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Line } from './register'
import {vlmEndpoint} from './vlm'

export function startOCR(){
  return createWorker('eng',OEM.LSTM_ONLY,{
    workerPath:'/ocr/worker.min.js',corePath:'/ocr/tesseract-core-lstm.wasm.js',
    langPath:'/ocr',workerBlobURL:false
  })
}

const fullPage: Line['box'] = [0,0,1,1]

export async function recognizePage(
  page: PDFPageProxy, worker?: Awaited<ReturnType<typeof startOCR>>, region = fullPage, endpoint?: string,
): Promise<Line[]> {
  const base = page.getViewport({scale:1})
  const view = page.getViewport({scale:Math.min(3,2400/Math.max(base.width,base.height))})
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(view.width * (region[2]-region[0]))
  canvas.height = Math.ceil(view.height * (region[3]-region[1]))
  const boxOnPage = (box: Line['box']): Line['box'] => [
    region[0]+box[0]*canvas.width/view.width,region[1]+box[1]*canvas.height/view.height,
    Math.min(1,region[0]+box[2]*canvas.width/view.width),Math.min(1,region[1]+box[3]*canvas.height/view.height),
  ]
  const normalize = (box:{x0:number;y0:number;x1:number;y1:number}): Line['box'] =>
    boxOnPage([box.x0/canvas.width,box.y0/canvas.height,box.x1/canvas.width,box.y1/canvas.height])
  let ownWorker: Awaited<ReturnType<typeof startOCR>> | undefined
  try {
    await page.render({canvas,viewport:view,transform:[1,0,0,1,-region[0]*view.width,-region[1]*view.height]}).promise
    if (endpoint===vlmEndpoint) {
      const {recognizeWithVlm} = await import('./vlm')
      return (await recognizeWithVlm(canvas)).map(line => ({page:page.pageNumber,text:line.text,box:boxOnPage(line.box),ocr:true,block_type:'vlm'}))
    }
    if (endpoint) {
      const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Could not render the OCR image.')), 'image/png'))
      const response = await fetch(endpoint,{method:'POST',body:blob,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(45000)})
      if (!response.ok) {
        const detail = endpoint.startsWith('/') ? (await response.json().catch(()=>null))?.error : undefined
        throw Error(detail ?? 'Hosted OCR returned HTTP ' + response.status + '.')
      }
      const {lines} = await response.json() as {lines?: Line[]}
      if (!Array.isArray(lines) || lines.length > 3000 || !lines.every(line => typeof line?.text === 'string' &&
        Array.isArray(line.box) && line.box.length === 4 && line.box.every(n => Number.isFinite(n) && n >= 0 && n <= 1) &&
        line.box[0] < line.box[2] && line.box[1] < line.box[3] && (line.confidence === undefined ||
          (Number.isFinite(line.confidence) && line.confidence >= 0 && line.confidence <= 100)))) throw Error('Hosted OCR returned invalid line data.')
      return lines.filter(line => line.text.trim()).map(line => ({
        page:page.pageNumber,text:line.text.trim(),box:boxOnPage(line.box),ocr:true,confidence:line.confidence,block_type:line.block_type,wordConfidence:line.wordConfidence,
      }))
    }
    if (!worker) worker = ownWorker = await startOCR()
    const {data} = await worker.recognize(canvas, {}, {blocks:true})
    return (data.blocks??[]).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => {
      let offset = 0
      const words = line.words.filter(word => word.text.trim()).map(word => {
        const text = word.text.trim()
        const start = offset
        offset += text.length + 1
        return {text,start,end:offset-1,box:normalize(word.bbox)}
      })
      return {page:page.pageNumber,ocr:true,confidence:line.confidence,text:words.map(word => word.text).join(' ') || line.text.trim(),
        box:normalize(line.bbox),words}
    }))).filter(line => line.text)
  } finally {
    canvas.width = canvas.height = 0
    await ownWorker?.terminate()
  }
}
