import {extractionEngine} from './extraction-engines.js'
import {createServer} from 'node:http'
import {Readable} from 'node:stream'
import {resolve,extname,sep} from 'node:path'
import {readFile} from 'node:fs/promises'
import {service} from './service.js'
import {read} from './read-local.js'
import {attachWorkspaceBridge} from './workspace-bridge.js'
import {agentSettings} from './agent-settings.js'
const port=Number(process.env.PORT||8031)
const origin='http://127.0.0.1:'+port
const root=resolve('dist/client')
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.pdf':'application/pdf','.woff2':'font/woff2','.wasm':'application/wasm'}
let active=0
const server = createServer(async(req,res)=>{
  try{
    if(req.headers.host!=='127.0.0.1:'+port&&req.headers.host!=='localhost:'+port){res.writeHead(403).end();return}
    const requestOrigin='http://'+req.headers.host
    const url=new URL(req.url,requestOrigin)
    if(url.origin!==requestOrigin){res.writeHead(400).end();return}
    if(url.pathname==='/api/local/agents'){
      const response=await agentSettings(req,'http://'+req.headers.host)
      res.writeHead(response.status,Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));return
    }
    const post=req.method==='POST'
    if(post&&active>=2){res.writeHead(429,{'Retry-After':'5'}).end();return}
    let response
    if(post)active++
    try{
      const request = new Request(url,{method:req.method,headers:req.headers,body:post?Readable.toWeb(req):undefined,duplex:'half'})
      response = await extractionEngine(request) ?? await service(request,read,bridge)
    }finally{if(post)active--}
    if(response){res.writeHead(response.status,Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));return}
    const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname))
    if(!file.startsWith(root+sep)||req.method!=='GET'){res.writeHead(404).end();return}
    const bytes=await readFile(file)
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(bytes)
  }catch{res.writeHead(404).end()}
})
const bridge = attachWorkspaceBridge(server,port)
server.listen(port,'127.0.0.1',()=>console.log('Folio listening on '+origin))
