import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {service} from '../server/service.js'
import {read} from '../server/read-local.js'
import {readMistralBlocks,extractionEngine} from '../server/extraction-engines.js'

const url = 'http://127.0.0.1:8031'
const call = async (method,params={}) => {
  const response = await service(new Request(url+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),read)
  assert.equal(response.status,200)
  return (await response.json()).result
}
const pdf = await readFile(new URL('../public/northfield-sample.pdf',import.meta.url))
const headers = {'Content-Type':'application/pdf'}
const response = await service(new Request(url+'/api/v2/analyze',{method:'POST',headers,body:pdf}),read)
assert.equal(response.status,200)
const actual = await response.json()
assert.equal(actual.findings.length,10)
const net = actual.findings.find(f=>f.metric==='net_income' && f.end_date==='2025-12-31')
assert.match(net.source.text,/Net income · 15\.8 · .*December 31, 2025/)
assert(!net.source.text.includes('14.4'))
assert(net.source.box[2]>net.source.box[0])
assert.equal((await call('initialize',{protocolVersion:'2025-11-25'})).protocolVersion,'2025-11-25')
const tools = await call('tools/list')
assert.deepEqual(tools.tools.map(tool=>tool.name),['analyze_pdf','analyze_text'])
const analyzed = await call('tools/call',{name:'analyze_pdf',arguments:{pdf_base64:pdf.toString('base64'),metric:'net_income',limit:1}})
const parsed = JSON.parse(analyzed.content[0].text)
assert.equal(parsed.matched_count,2)
assert.equal(parsed.next_offset,1)
assert.equal(parsed.findings[0].amount,'15.8')
const narrative = await call('tools/call',{name:'analyze_text',arguments:{pages:['Revenue: USD 128.4 million']}})
assert.equal(JSON.parse(narrative.content[0].text).findings[0].amount,'128.4')

const spoofed = await extractionEngine(new Request(url+'/api/local/mistral-ocr',{method:'POST',headers:{Origin:'https://other.invalid'}}))
assert.equal(spoofed.status,403)
assert.deepEqual(readMistralBlocks({pages:[{dimensions:{width:100,height:200},blocks:[{
  type:'title',content:'# Net income',top_left_x:10,top_left_y:20,bottom_right_x:45,bottom_right_y:40,
  confidence_scores:{minimum_content_confidence_score:.94},
}]}]}),[{text:'Net income',box:[.1,.1,.45,.2],block_type:'title',confidence:94}])
console.log('REST, MCP compatibility and OCR adapter checks passed.')
assert.deepEqual(readMistralBlocks({pages:[{dimensions:{width:10,height:10},markdown:'20.0 USD',
  confidence_scores:{word_confidence_scores:[{start_index:0,text:'20.0',confidence:.8},{start_index:5,text:'USD',confidence:.95}]},
  blocks:[{type:'text',content:'20.0 USD',top_left_x:0,top_left_y:0,bottom_right_x:10,bottom_right_y:10}],
}]}),[{text:'20.0 USD',box:[0,0,1,1],block_type:'text',confidence:80,
  wordConfidence:[{text:'20.0',confidence:80},{text:'USD',confidence:95}]}])
