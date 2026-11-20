import {randomUUID} from 'node:crypto'
import {WebSocket,WebSocketServer} from 'ws'

export function attachWorkspaceBridge(server,port) {
  const websocket = new WebSocketServer({noServer:true,maxPayload:16*1024*1024})
  const tabs = new Map()
  const requests = new Map()
  let sequence = 0
  const active = () => [...tabs].filter(([socket])=>socket.readyState===WebSocket.OPEN)
    .sort(([,a],[,b])=>b.activity-a.activity)[0]

  server.on('upgrade',(req,socket,head)=>{
    const host = req.headers.host
    if (req.url!=='/api/local/workspace' || !['127.0.0.1:'+port,'localhost:'+port].includes(host) ||
      req.headers.origin!=='http://'+host) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    websocket.handleUpgrade(req,socket,head,connection=>websocket.emit('connection',connection))
  })
  websocket.on('connection',socket=>{
    socket.on('error',()=>socket.terminate())
    socket.on('message',raw=>{
      let value
      try {value=JSON.parse(raw.toString())} catch {return}
      if (value?.type==='workspace' && value.consent && typeof value.consent==='object') {
        const activity = value.focused || !tabs.has(socket) ? ++sequence : tabs.get(socket).activity
        tabs.set(socket,{activity,consent:value.consent})
      } else if (value?.id) {
        const pending = requests.get(value.id)
        if (pending?.socket!==socket) return
        clearTimeout(pending.timer)
        requests.delete(value.id)
        if (typeof value.error==='string') pending.reject(Error(value.error))
        else pending.resolve(value.result)
      }
    })
    socket.on('close',()=>{
      tabs.delete(socket)
      for (const [id,pending] of requests) if (pending.socket===socket) {
        clearTimeout(pending.timer)
        requests.delete(id)
        pending.reject(Error('The Folio workspace disconnected.'))
      }
    })
  })

  return {
    allowed(name) { return active()?.[1].consent[name]===true },
    async call(operation,args={},agent='Agent',tool=false) {
      const tab = active()
      if (!tab) throw Error('Enable live workspace sharing in Agent MCP & Bridge.')
      const [socket,settings] = tab
      if (tool && settings.consent[operation]!==true) throw Error('Tool consent is disabled.')
      if (requests.size>=16) throw Error('The Folio workspace is busy.')
      const id = randomUUID()
      return new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>{
          requests.delete(id)
          reject(Error('The Folio workspace did not respond.'))
        },5000)
        requests.set(id,{socket,timer,resolve,reject})
        socket.send(JSON.stringify({id,operation,args,agent}),error=>{
          if (!error) return
          clearTimeout(timer)
          requests.delete(id)
          reject(error)
        })
      })
    },
  }
}
