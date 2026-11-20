import {expect,firefox,test,type Page} from '@playwright/test'
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import {readFile} from 'node:fs/promises'
import {digestJson} from '../src/audit'

const source = 'public/northfield-sample.pdf'

async function open(page:Page) {
  await page.goto('/')
  await expect(page.getByRole('button',{name:'Browse files'})).toBeEnabled()
  await page.getByLabel('Choose documents').setInputFiles(source)
  await expect(page.getByRole('heading',{name:'northfield-sample.pdf'})).toBeVisible()
  await page.getByLabel('Reviewer',{exact:true}).fill('Regression reviewer')
  await page.getByLabel('Reviewer',{exact:true}).blur()
}

test('status transitions, stable review session, keyboard saves and scale-locked edits',async({page})=>{
  await open(page)
  const counts = page.locator('.reader-heading .queue-status')
  await expect(counts).toContainText('10 Pending')
  await expect(page.getByText(/Item 1 of 10/)).toBeVisible()
  await page.keyboard.press('h')
  await page.getByLabel('Reason code').selectOption('Other')
  await page.getByRole('button',{name:'Save decision'}).click()
  await expect(counts).toContainText('9 Pending')
  await expect(counts).toContainText('1 On Hold')
  await expect(page.getByText(/Item 1 of 10/)).toContainText('On Hold')
  await expect(page.getByRole('button',{name:'Review queue',exact:true})).toContainText('9')
  await page.keyboard.press('Shift+E')
  await page.getByLabel('Reason code').selectOption('Other')
  await page.getByRole('button',{name:'Save decision'}).click()
  await expect(counts).toContainText('0 On Hold')
  await expect(counts).toContainText('1 Escalated')
  await page.getByText('Assignment and priority',{exact:true}).click()
  await page.getByLabel('Assignee',{exact:true}).fill('Finance')
  await page.getByLabel('Priority',{exact:true}).selectOption('High')
  await page.getByRole('button',{name:'Approve & Verify'}).click()
  await expect(counts).toContainText('1 Verified')
  await expect(counts).toContainText('0 Escalated')
  await page.getByRole('tab',{name:'Queue (9)'}).click()
  await page.getByLabel('Queue status').selectOption('Verified')
  await expect(page.locator('.findings')).toContainText('Finance')
  await expect(page.locator('.findings')).toContainText('High')
  await page.locator('.findings button').click()
  await expect(page.getByLabel('Value',{exact:true})).toHaveValue('128.4')
  await expect(page.getByLabel('Unit',{exact:true})).toHaveValue('USD million')
  await expect(page.getByLabel('Normalized')).toHaveText('128,400,000 USD')
  await page.getByLabel('Value',{exact:true}).focus()
  await page.keyboard.press(']')
  await expect(page.getByLabel('Value',{exact:true})).toHaveValue('128.4]')
  await expect(page.getByRole('button',{name:'Re-index OCR'})).toBeVisible()
  await page.getByRole('button',{name:'Re-index OCR'}).click()
  await expect(page.getByText('This page has verified figures.',{exact:false})).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('tab',{name:'Queue (9)'}).click()
  await page.getByLabel('Queue status').selectOption('Pending')
  await page.locator('.findings button').first().click()
  await expect(page.getByLabel('Verbatim Label')).toHaveValue('Operating income')
  await page.keyboard.press('Control+Enter')
  await expect(counts).toContainText('2 Verified')
  await expect(page.getByLabel('Verbatim Label')).toHaveValue('Free cash flow')
})

test('390px split sheet, live formula overlays and deterministic register jumps',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await open(page)
  await expect(page.locator('[data-rendered-page="1"]')).toBeVisible()
  const sourceBox = await page.getByRole('region',{name:'Source document'}).boundingBox()
  const sheetBox = await page.getByRole('complementary',{name:'Review workspace'}).boundingBox()
  expect(sourceBox!.y).toBeLessThan(sheetBox!.y)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390)
  for (const action of ['Save & next','Save only','Hold','Exclude']) {
    const button = page.getByRole('button',{name:action,exact:true})
    await expect(button).toBeInViewport()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(42)
  }
  await page.getByRole('tab',{name:'Queue (10)'}).click()
  await page.locator('.findings button').filter({hasText:'Net income'}).first().click()
  await expect(page.getByLabel('Source citation',{exact:false})).toHaveValue(/Net income · 15\.8 · .*December 31, 2025/)
  await page.getByRole('button',{name:/Net income.*Reconciles/}).click()
  await expect(page.locator('.formula-overlay rect')).toHaveCount(3)
  await expect(page.locator('.formula-overlay path')).toHaveCount(2)
  await expect(page.getByText('20.0 − 4.2 = 15.8 USD million')).toBeVisible()
  await page.screenshot({path:'output/playwright/folio-2.0-mobile.png'})
  await page.getByRole('button',{name:'Save only',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Edit verified figure'})).toBeVisible()
  await page.getByRole('button',{name:'Figure register',exact:true}).click()
  await page.getByRole('button',{name:'Net income',exact:true}).click()
  await expect(page.locator('[data-rendered-page="2"]')).toBeVisible()
  const rendered = await page.locator('.paper canvas').evaluate((canvas:HTMLCanvasElement)=>{
    const pixels = canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data
    return pixels.some((value,index)=>index%4===0 && value<120 && pixels[index+3]===255)
  })
  expect(rendered).toBe(true)
  await expect(page.locator('[data-active-anchor]')).toBeVisible()
})

test('OPFS survives reload and backup SHA-256 verification detects tampering',async({page,browser,baseURL})=>{
  await open(page)
  await page.getByRole('button',{name:'Save only',exact:true}).click()
  await page.getByRole('button',{name:'Activity history'}).click()
  await expect(page.getByText('SHA-256 Hash Chain Verified',{exact:true})).toBeVisible()
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button',{name:'Figure register',exact:true}).last().click()
  await page.getByRole('button',{name:'CSV',exact:true}).click()
  const csv = await readFile((await (await csvDownload).path())!,'utf8')
  expect(csv).toContain(',128.4,"USD million",')
  expect(csv).toContain(',128400000,"USD"')
  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button',{name:'Excel',exact:true}).click()
  const workbook = unzipSync(new Uint8Array(await readFile((await (await excelDownload).path())!)))
  expect(strFromU8(workbook['xl/worksheets/sheet1.xml'])).toContain('<v>128400000</v>')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button',{name:'Backup',exact:true}).click()
  const parts = unzipSync(new Uint8Array(await readFile((await (await downloaded).path())!)))
  const manifest = JSON.parse(strFromU8(parts['manifest.json']))
  expect(manifest.version).toBe(2)
  expect(manifest.history[0].source_pdf_sha256).toBe(manifest.id)
  const original = Buffer.from(zipSync(parts))
  const opfs = await page.evaluate(async()=>{
    const root = await navigator.storage.getDirectory()
    return (await root.getDirectoryHandle('.folio-2')).kind
  })
  expect(opfs).toBe('directory')
  await page.reload()
  await page.getByRole('button',{name:'northfield-sample.pdf',exact:false}).first().click()
  await expect(page.locator('.reader-heading .queue-status')).toContainText('1 Verified')
  manifest.history[0].reviewer = 'Substituted reviewer'
  const {manifest_sha256,...modified} = manifest
  parts['manifest.json'] = strToU8(JSON.stringify({...modified,manifest_sha256:await digestJson(modified)}))
  await page.getByLabel('Choose documents').setInputFiles({name:'tampered.folio',mimeType:'application/zip',buffer:Buffer.from(zipSync(parts))})
  await expect(page.locator('.notice.error')).toContainText('SHA-256 verification failed')
  const firefoxPath = process.env.FOLIO_TEST_FIREFOX
  const secondEngine = firefoxPath ? await firefox.launch({executablePath:firefoxPath}) : undefined
  const fresh = await (secondEngine ?? browser).newContext({baseURL})
  await fresh.addInitScript(()=>{
    Object.defineProperty(StorageManager.prototype,'getDirectory',{value:undefined,configurable:true})
  })
  try {
    const restored = await fresh.newPage()
    await restored.goto('/')
    await expect(restored.getByRole('button',{name:'Browse files'})).toBeEnabled()
    await restored.getByLabel('Choose documents').setInputFiles({name:'valid.folio',mimeType:'application/zip',buffer:original})
    await expect(restored.locator('.reader-heading .queue-status')).toContainText('1 Verified')
    await restored.getByRole('button',{name:'Activity history'}).click()
    await expect(restored.getByText('SHA-256 Hash Chain Verified',{exact:true})).toBeVisible()
  } finally {
    await fresh.close()
    await secondEngine?.close()
  }

})

test('2026 MCP live resources, consent, draft rejection and human approval',async({page,request})=>{
  await open(page)
  const call = async (method:string,params:Record<string,unknown>={})=>{
    const name = params.name ?? params.uri
    const response = await request.post('/mcp',{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,
      ...(typeof name==='string' ? {'Mcp-Name':name} : {})},data:{jsonrpc:'2.0',id:1,method,params}})
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const tools = async()=> (await call('tools/list')).result.tools.map((tool:{name:string})=>tool.name)
  expect((await call('server/discover')).result.supportedVersions).toContain('2026-07-28')
  expect(await tools()).toEqual(['analyze_pdf','analyze_text'])
  await page.getByRole('button',{name:'Agent MCP & Bridge'}).click()
  await page.getByLabel('Share this workspace with local MCP clients').check()
  await expect(page.getByText('Browser workspace connected',{exact:true})).toBeVisible()
  await page.getByLabel(/propose_finding_edit/).check()
  await page.getByLabel(/query_figure_register/).check()
  await page.getByLabel(/explain_reconciliation_variance/).check()
  await page.getByRole('button',{name:'northfield-sample.pdf',exact:false}).first().click()
  await expect(page.getByRole('heading',{name:'northfield-sample.pdf'})).toBeVisible()
  await expect.poll(tools).toContain('propose_finding_edit')
  expect((await call('resources/list')).result.resources).toHaveLength(3)
  const read = async (uri:string)=>{
    const result = await call('resources/read',{uri:'folio://'+uri})
    expect(result.error).toBeUndefined()
    return JSON.parse(result.result.contents[0].text)
  }
  const unresolved = await read('workpapers/active/unresolved')
  const staged = async()=> (await call('tools/call',{name:'propose_finding_edit',arguments:{workpaper_id:unresolved.workpaper_id,
    finding_id:unresolved.findings[0].finding_id,changes:{canonicalMetric:'Revenue (US-GAAP)',amount:'128.5'},rationale:'Source review proposal'}})).result
  expect(await read('workpapers/active/variances')).toHaveProperty('variances')
  expect((await staged()).structuredContent.status).toBe('Draft')
  await expect(page.getByLabel('Proposed by Agent (Draft)')).toBeVisible()
  expect((await read('register/verified')).entries).toHaveLength(0)
  await page.getByRole('button',{name:'Reject Draft'}).click()
  await expect(page.getByLabel('Proposed by Agent (Draft)')).toHaveCount(0)
  expect((await staged()).structuredContent.status).toBe('Draft')
  await page.getByRole('button',{name:'Approve & Verify'}).click()
  await expect(page.getByRole('heading',{name:'Edit verified figure'})).toBeVisible()
  const query = (await call('tools/call',{name:'query_figure_register',arguments:{query:'US-GAAP'}})).result
  expect(query.structuredContent.entries[0].figure.amount).toBe('128.5')
})

test('migrates a Folio 1.2 IndexedDB profile and keeps edits in native units',async({page})=>{
  await page.goto('/folio.svg')
  await page.evaluate(async()=>{
    const file = new File([await (await fetch('/northfield-sample.pdf')).blob()],'Legacy workpaper.pdf',{type:'application/pdf'})
    const hash = await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
    const id = Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('')
    const source = {page:1,text:'Revenue: USD 128.4 million',box:[.08,.26,.26,.3]}
    const original = {label:'Revenue',amount:'128.4',unit:'USD million',period:'FY2025',source}
    const saved = '2026-11-19T10:00:00.000Z'
    const figure = {id:'legacy-revenue',label:'Revenue',amount:'128400000',unit:'USD',period:'FY2025',source,saved,
      note:'Legacy import',original,findingKey:JSON.stringify([1,source.text,null,'Revenue','128.4','FY2025','USD million'])}
    const request = indexedDB.open('folio-document-register',1)
    const db = await new Promise<IDBDatabase>((resolve,reject)=>{
      request.onupgradeneeded = ()=>['files','headers'].forEach(name=>request.result.createObjectStore(name,{keyPath:'id'}))
      request.onsuccess = ()=>resolve(request.result)
      request.onerror = ()=>reject(request.error)
    })
    await new Promise<void>((resolve,reject)=>{
      const tx = db.transaction(['files','headers'],'readwrite')
      const header = {id,name:file.name,pages:2,added:saved,count:1}
      tx.objectStore('headers').put(header)
      tx.objectStore('files').put({...header,file,lines:[source],figures:[figure],
        history:[{id:'legacy-event',action:'Verify figure',reviewer:'Legacy reviewer',reason:'',saved,original,after:figure}]})
      tx.oncomplete = ()=>resolve()
      tx.onerror = ()=>reject(tx.error)
    })
    db.close()
  })
  await page.goto('/')
  await page.getByRole('button',{name:'Figure register',exact:true}).click()
  await expect(page.getByText('128,400,000 USD',{exact:true})).toBeVisible()
  await expect(page.getByText('SHA-256 Hash Chain Verified',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Revenue',exact:true}).click()
  await expect(page.getByLabel('Value',{exact:true})).toHaveValue('128.4')
  await expect(page.getByLabel('Unit',{exact:true})).toHaveValue('USD million')
})

test('serializes concurrent workpaper saves from two tabs',async({page})=>{
  await open(page)
  const other = await page.context().newPage()
  await other.goto('/')
  await other.getByRole('button',{name:'northfield-sample.pdf',exact:true}).first().click()
  await expect(other.getByRole('heading',{name:'northfield-sample.pdf'})).toBeVisible()
  await expect(other.getByLabel('Reviewer',{exact:true})).toHaveValue('Regression reviewer')
  await other.getByRole('button',{name:'Next finding',exact:true}).click()
  await expect(other.getByLabel('Verbatim Label')).toHaveValue('Operating income')
  await Promise.all([page,other].map(tab=>tab.getByRole('button',{name:'Save only',exact:true}).click()))
  await Promise.all([page,other].map(tab=>expect(tab.getByRole('heading',{name:'Edit verified figure'})).toBeVisible()))
  await page.reload()
  await page.getByRole('button',{name:'northfield-sample.pdf',exact:true}).first().click()
  await expect(page.locator('.reader-heading .queue-status')).toContainText('2 Verified')
  await page.getByRole('button',{name:'Activity history'}).click()
  await expect(page.getByText('SHA-256 Hash Chain Verified',{exact:true})).toBeVisible()
})

test('OCR re-index replaces page overlays and keeps the verified citation',async({page})=>{
  await open(page)
  await page.getByRole('button',{name:'Save only',exact:true}).click()
  await expect(page.locator('.paper .evidence-box.verified')).toHaveCount(1)
  await page.getByRole('button',{name:'Agent MCP & Bridge'}).click()
  await page.getByLabel('Manual OCR engine').selectOption('hosted')
  const endpoint = 'https://ocr.example.test/recognize'
  await page.getByLabel('Hosted OCR endpoint').fill(endpoint)
  await page.getByRole('button',{name:'Save preferences'}).click()
  await expect(page.getByText('Workspace preferences saved.',{exact:true})).toBeVisible()
  await page.route(endpoint,route=>route.fulfill({
    status:200,headers:{'Access-Control-Allow-Origin':'*'},json:{lines:[
      {text:'Fiscal year ended 31 December 2025',box:[.1,.2,.5,.23],confidence:96},
      {text:'Revenue: USD 130 million',box:[.2,.56,.5,.60],confidence:94},
    ]},
  }))
  await page.getByRole('button',{name:'northfield-sample.pdf',exact:true}).first().click()
  await page.getByRole('button',{name:'Re-index OCR',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Re-index OCR',exact:true}).click()
  await expect(page.getByText('Updated searchable text on page 1.',{exact:true})).toBeAttached()
  await expect(page.locator('.paper .evidence-box.verified')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/Revenue · 130 · FY2025/})).toBeVisible()
  await expect(page.locator('.workpaper-table')).toContainText('Revenue: USD 128.4 million')
})
