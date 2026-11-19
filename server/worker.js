import {getDocument} from 'unpdf/pdfjs'
import {service} from './service.js'
import {readPages} from './pages.js'
import html from '../dist/client/index.html'
const read=async data=>readPages(getDocument({data,isEvalSupported:false,useSystemFonts:false,maxImageSize:16000000}))
export default {async fetch(request,env){
  const response=await service(request,read)
  if(response)return response
  if(new URL(request.url).pathname==='/')return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}})
  return env.ASSETS?.fetch(request)??new Response('Not found',{status:404})
}}
