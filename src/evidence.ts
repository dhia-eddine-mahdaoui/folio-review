import type {Line, RecordFile} from './register'

// Renders the cited region of a page to a PNG data URL for agent hosts that display MCP Apps cards.
export async function cropEvidence(doc:RecordFile, page:number, box:Line['box'], width = 560) {
  if (!(box[2]>box[0] && box[3]>box[1])) return undefined
  const {getDocument} = await import('./pdf')
  const task = getDocument({data:new Uint8Array(await doc.file.arrayBuffer()),standardFontDataUrl:'/pdf-fonts/'})
  try {
    const pdfPage = await (await task.promise).getPage(page)
    const base = pdfPage.getViewport({scale:1})
    const pad = .02
    const region = [Math.max(0,box[0]-pad*3),Math.max(0,box[1]-pad),Math.min(1,box[2]+pad*3),Math.min(1,box[3]+pad)]
    const scale = Math.min(4,width/(base.width*(region[2]-region[0])))
    const view = pdfPage.getViewport({scale})
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(view.width*(region[2]-region[0]))
    canvas.height = Math.ceil(view.height*(region[3]-region[1]))
    await pdfPage.render({canvas,viewport:view,transform:[1,0,0,1,-region[0]*view.width,-region[1]*view.height]}).promise
    const context = canvas.getContext('2d')!
    context.strokeStyle = '#1a73e8'
    context.setLineDash([4,3])
    context.strokeRect((box[0]-region[0])*view.width-2,(box[1]-region[1])*view.height-2,(box[2]-box[0])*view.width+4,(box[3]-box[1])*view.height+4)
    return canvas.toDataURL('image/png')
  } finally {
    await task.destroy()
  }
}
