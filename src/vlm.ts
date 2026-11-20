import type {Line} from './register'

export const vlmEndpoint = 'vlm:local'
export const vlmModel = 'onnx-community/Florence-2-base-ft'

export type VlmOutput = {quad_boxes:number[][]; labels:string[]}

export async function webgpuAvailable() {
  const gpu = (navigator as Navigator & {gpu?:{requestAdapter:()=>Promise<unknown>}}).gpu
  if (!gpu) return false
  try {return !!await gpu.requestAdapter()} catch {return false}
}

// Florence-2 <OCR_WITH_REGION> returns one quadrilateral per text line in image pixels.
export function vlmLines(output:VlmOutput, width:number, height:number):Pick<Line,'text'|'box'>[] {
  if (!Array.isArray(output?.quad_boxes) || !Array.isArray(output.labels) || !(width>0 && height>0)) return []
  return output.quad_boxes.flatMap((quad,index)=>{
    const text = String(output.labels[index] ?? '').replace(/<\/?s>|<pad>/g,'').trim()
    if (!text || !Array.isArray(quad) || quad.length<8 || !quad.every(Number.isFinite)) return []
    const xs = quad.filter((_,i)=>i%2===0), ys = quad.filter((_,i)=>i%2===1)
    const box:Line['box'] = [Math.max(0,Math.min(...xs)/width),Math.max(0,Math.min(...ys)/height),
      Math.min(1,Math.max(...xs)/width),Math.min(1,Math.max(...ys)/height)]
    return box[0]<box[2] && box[1]<box[3] ? [{text,box}] : []
  }).sort((a,b)=>a.box[1]-b.box[1] || a.box[0]-b.box[0])
}

let worker:Worker | undefined
let sequence = 0
const pending = new Map<number,{resolve:(value:VlmOutput)=>void; reject:(error:Error)=>void; progress?:(message:string)=>void}>()

function vlmWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./vlm.worker.ts',import.meta.url),{type:'module'})
  worker.onmessage = ({data}) => {
    const request = pending.get(data.id)
    if (!request) return
    if (data.progress) return request.progress?.(data.progress)
    pending.delete(data.id)
    if (data.error) request.reject(Error(data.error))
    else request.resolve(data.result)
  }
  worker.onerror = event => {
    for (const request of pending.values()) request.reject(Error(event.message || 'The in-browser VLM worker stopped.'))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

export async function recognizeWithVlm(canvas:HTMLCanvasElement, progress?:(message:string)=>void) {
  const image = canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height)
  const device = await webgpuAvailable() ? 'webgpu' : 'wasm'
  const id = ++sequence
  const output = await new Promise<VlmOutput>((resolve,reject)=>{
    pending.set(id,{resolve,reject,progress})
    vlmWorker().postMessage({id,device,model:vlmModel,width:image.width,height:image.height,pixels:image.data.buffer},[image.data.buffer])
  })
  return vlmLines(output,canvas.width,canvas.height)
}
