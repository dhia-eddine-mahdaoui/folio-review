import {resolve} from 'node:path'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {createCanvas} from '@napi-rs/canvas'
import {createWorker} from 'tesseract.js'
import {readPages} from './pages.js'

export async function read(data){
  let worker
  try{
    const pdf=getDocument({data,isEvalSupported:false,maxImageSize:16000000,standardFontDataUrl:resolve('dist/client/pdf-fonts')+'/'})
    return await readPages(pdf,async page=>{
      worker??=await createWorker('eng',1,{langPath:resolve('dist/client/ocr'),cacheMethod:'none'})
      const base=page.getViewport({scale:1})
      const viewport=page.getViewport({scale:Math.min(3,2400/Math.max(base.width,base.height))})
      const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
      await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise
      return (await worker.recognize(canvas.toBuffer('image/png'))).data.text
    })
  }finally{await worker?.terminate()}
}
