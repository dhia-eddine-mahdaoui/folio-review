import {AutoProcessor, Florence2ForConditionalGeneration, Florence2Processor, RawImage, env} from '@huggingface/transformers'

type Request = {id:number; device:'webgpu'|'wasm'; model:string; width:number; height:number; pixels:ArrayBuffer}
const task = '<OCR_WITH_REGION>'
env.allowLocalModels = false
let loaded:Promise<{model:Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>; processor:Florence2Processor}> | undefined
let loadedDevice = ''

function load(id:number, device:Request['device'], name:string) {
  if (loaded && loadedDevice===device) return loaded
  loadedDevice = device
  const progress = (event:{status?:string; file?:string; progress?:number}) => {
    if (event.status==='progress' && event.file) self.postMessage({id,progress:`Downloading ${event.file} · ${Math.round(event.progress ?? 0)}%`})
  }
  // Quantized weights keep the first download small; WebGPU runs the vision encoder in fp16.
  const dtype = device==='webgpu'
    ? {embed_tokens:'fp16',vision_encoder:'fp16',encoder_model:'q4',decoder_model_merged:'q4'} as const
    : {embed_tokens:'q8',vision_encoder:'q8',encoder_model:'q8',decoder_model_merged:'q8'} as const
  loaded = Promise.all([
    Florence2ForConditionalGeneration.from_pretrained(name,{device,dtype,progress_callback:progress}),
    AutoProcessor.from_pretrained(name),
  ]).then(([model,processor])=>({model,processor:processor as Florence2Processor}))
  loaded.catch(()=>{loaded = undefined})
  return loaded
}

self.onmessage = async ({data}:MessageEvent<Request>) => {
  const {id,device,model:name,width,height,pixels} = data
  try {
    const {model,processor} = await load(id,device,name)
    self.postMessage({id,progress:'Reading page with the in-browser VLM'})
    const image = new RawImage(new Uint8ClampedArray(pixels),width,height,4).rgb()
    const inputs = await processor(image,processor.construct_prompts(task))
    const generated = await model.generate({...inputs,max_new_tokens:1024}) as Parameters<Florence2Processor['batch_decode']>[0]
    const text = processor.batch_decode(generated,{skip_special_tokens:false})[0]
    const result = processor.post_process_generation(text,task,image.size as [number,number])[task]
    self.postMessage({id,result})
  } catch (error) {
    self.postMessage({id,error:error instanceof Error ? error.message : 'The in-browser VLM could not read this page.'})
  }
}
