import {createServer} from 'node:http'
import {Readable} from 'node:stream'
import {resolve,extname,sep} from 'node:path'
import {readFile} from 'node:fs/promises'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {createCanvas} from '@napi-rs/canvas'
import {createWorker} from 'tesseract.js'
import {service} from './service.js'
import {readPages} from './pages.js'

async function read(data){
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
const port=Number(process.env.PORT||8031)
const origin='http://127.0.0.1:'+port
const root=resolve('dist/client')
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'}
let active=0
createServer(async(req,res)=>{
  try{
    if(req.headers.host!=='127.0.0.1:'+port&&req.headers.host!=='localhost:'+port){res.writeHead(403).end();return}
    const url=new URL(req.url,origin)
    if(url.origin!==origin){res.writeHead(400).end();return}
    const post=req.method==='POST'
    if(post&&active>=2){res.writeHead(429,{'Retry-After':'5'}).end();return}
    let response
    if(post)active++
    try{response=await service(new Request(url,{method:req.method,headers:req.headers,body:post?Readable.toWeb(req):undefined,duplex:'half'}),read)}finally{if(post)active--}
    if(response){res.writeHead(response.status,Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));return}
    const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname))
    if(!file.startsWith(root+sep)||req.method!=='GET'){res.writeHead(404).end();return}
    const bytes=await readFile(file)
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(bytes)
  }catch{res.writeHead(404).end()}
}).listen(port,'127.0.0.1',()=>console.log('Folio listening on '+origin))
