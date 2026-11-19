import { createWorker, OEM } from 'tesseract.js'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Line } from './register'

export function startOCR(){
  return createWorker('eng',OEM.LSTM_ONLY,{
    workerPath:'/ocr/worker.min.js',corePath:'/ocr/tesseract-core-lstm.wasm.js',
    langPath:'/ocr',workerBlobURL:false
  })
}
export async function recognizePage(page:PDFPageProxy,worker:Awaited<ReturnType<typeof startOCR>>):Promise<Line[]>{
  const base=page.getViewport({scale:1})
  const view=page.getViewport({scale:Math.min(3,2400/Math.max(base.width,base.height))})
  const canvas=document.createElement('canvas')
  canvas.width=Math.ceil(view.width); canvas.height=Math.ceil(view.height)
  try{
    await page.render({canvas,viewport:view}).promise
    const {data}=await worker.recognize(canvas,{}, {blocks:true})
    return (data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>({
      page:page.pageNumber,text:l.text.trim(),box:[l.bbox.x0/canvas.width,l.bbox.y0/canvas.height,l.bbox.x1/canvas.width,l.bbox.y1/canvas.height] as Line['box']
    })))).filter(l=>l.text)
  }finally{canvas.width=canvas.height=0}
}
