import {normalizedAmount,sourceScale} from './amount'
import {strToU8,zipSync} from 'fflate'
import {findings} from './findings'
import {findingKey, findingStatus, workpaperFindings} from './review'
import type {Figure, RecordFile} from './register'
import {reconciliation} from './reconciliation'
import {analyzeLines, type Finding} from './findings'
import {reviewedFinding} from './review'
import {tieOuts} from './tieout'

type Cell = string|number|{f:string; v?:string|number}

const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRel='http://schemas.openxmlformats.org/package/2006/relationships'
function escape(value:string){
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
}
function column(index:number){
  let name=''
  for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name
  return name
}
function sheet(rows:Cell[][],widths:number[]){
  const content=rows.map((row,index)=>{
    const cells=row.map((v,i)=>{
      const ref=column(i)+(index+1)
      if(typeof v==='number')return '<c r="'+ref+'"><v>'+v+'</v></c>'
      if(typeof v==='object')return typeof v.v==='string'
        ? '<c r="'+ref+'" t="str"><f>'+escape(v.f)+'</f><v>'+escape(v.v)+'</v></c>'
        : '<c r="'+ref+'"><f>'+escape(v.f)+'</f>'+(v.v===undefined ? '' : '<v>'+v.v+'</v>')+'</c>'
      return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+escape(v.slice(0,32767))+'</t></is></c>'
    })
    return '<row r="'+(index+1)+'">'+cells.join('')+'</row>'
  })
  const cols=widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>')
  return '<worksheet xmlns="'+main+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+cols.join('')+'</cols><sheetData>'+content.join('')+'</sheetData></worksheet>'
}
export function writeWorkbook(doc:RecordFile,selected=doc.figures){
  const bytes = buildWorkbook(doc,selected)
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const link=document.createElement('a');link.href=url;link.download=doc.name.replace(/\.pdf$/i,'')+'.xlsx';link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function buildWorkbook(doc:RecordFile,selected=doc.figures){
  const figures:(string|number)[][]=[['Metric','Value','Unit','Period','Source PDF','Page','Evidence','Reviewer note','Reviewed UTC','Original value','Original unit','Original period','Reviewer ID','Change reason','Verbatim label','Normalized value','Normalized unit']]
  const numeric=(value:string)=>value && value.replace(/[^0-9]/g,'').length<=15&&Number.isFinite(Number(value))?Number(value):value
  for(const figure of selected) {
    const f = sourceScale(figure)
    const normalized = normalizedAmount(f.amount,f.unit)
    figures.push([f.label,numeric(f.amount),f.unit,f.period,doc.name,f.source.page,f.source.text,f.note,f.saved,
      numeric(f.original?.amount??''),f.original?.unit??'',f.original?.period??'',f.reviewer??'',f.changeReason??'',
      f.verbatimLabel??f.original?.source_label??f.original?.label??'',numeric(normalized?.value??''),normalized?.unit??''])
  }
  const evidence:(string|number)[][]=[['Metric','Extracted value','Unit','Period','Page','Evidence','Status','Reason code','Details','Decided UTC','Reviewer ID','Assignee','Priority']]
  for (const f of workpaperFindings(findings(doc.lines),doc.figures,doc.exclusions,doc.assignments)) {
    const key = findingKey(f)
    const status = findingStatus(f, doc.figures, doc.exclusions)
    const decision = doc.exclusions?.[key]
    const assignment = doc.assignments?.[key]
    evidence.push([f.label,f.amount,f.unit,f.period,f.source.page,f.source.text,status,decision?.code ?? '',decision?.reason ?? '',
      decision?.reason ? decision.saved : '',decision?.reason ? decision.reviewer ?? '' : '',assignment?.assignee ?? '',assignment?.priority ?? 'Normal'])
  }
  const audit:Cell[][] = [['Action','Reviewer ID','Reason','UTC','Original prediction','Before','After','Previous SHA-256','Event SHA-256','Source PDF SHA-256','Assignment']]
  for (const event of [...(doc.history ?? [])].sort((a,b)=>b.saved.localeCompare(a.saved))) audit.push([
    event.action,event.reviewer,event.reason,event.saved,JSON.stringify(event.original) ?? '',
    JSON.stringify(event.ocr?.before ?? event.before) ?? '',JSON.stringify(event.ocr?.after ?? event.after) ?? '',
    event.prev_hash ?? '',event.hash ?? '',event.source_pdf_sha256 ?? '',JSON.stringify(event.routing) ?? '',
  ])
  const summary = reconciliationSummary(doc)
  const sheetNames = ['Reconciliation Summary','Reviewed figures','Document findings','Activity history']
  const sheetIds = sheetNames.map((_,index)=>index+1)
  const parts:Record<string,string>={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheetIds.map(i=>'<Override PartName="/xl/worksheets/sheet'+i+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
    '_rels/.rels':'<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets>'+sheetIds.map((id,index)=>'<sheet name="'+sheetNames[index]+'" sheetId="'+id+'" r:id="rId'+id+'"/>').join('')+'</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+packageRel+'">'+sheetIds.map(i=>'<Relationship Id="rId'+i+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+i+'.xml"/>').join('')+'</Relationships>',
    'xl/worksheets/sheet1.xml':sheet(summary,[38,34,14,16,30,8,16,12]),
    'xl/worksheets/sheet2.xml':sheet(figures,[32,18,18,20,40,10,90,45,26,18,18,20,24,45]),
    'xl/worksheets/sheet3.xml':sheet(evidence,[30,18,18,16,10,100,18,25,45,26,24,24,14]),
    'xl/worksheets/sheet4.xml':sheet(audit,[25,24,40,26,60,60,60])
  }
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name,value])=>[name,strToU8(value)])))
}

// Each check is a block of source rows followed by a live variance formula, so the workbook recomputes if a value is edited.
function reconciliationSummary(doc:RecordFile):Cell[][] {
  const rows:Cell[][] = [['Check','Source line','Value','Unit','Period','Page','SHA-256 Audit Hash','Source Link']]
  const pdf = doc.name.replaceAll('"','""')
  const decimal = (value:string) => Number(value)
  const hashFor = (finding:Finding) => {
    const figure = reviewedFinding(finding,doc.figures)
    const event = figure && [...(doc.history ?? [])].reverse().find(entry=>entry.after && 'id' in entry.after && entry.after.id===figure.id)
    return event?.hash ? event.hash.slice(0,12) : 'unverified'
  }
  const line = (check:string, finding:Finding, sign=1):Cell[] => {
    const figure = reviewedFinding(finding,doc.figures)
    const observed = figure ? sourceScale(figure) : finding
    const value = decimal(observed.amount)*sign
    return [check,finding.source_label ?? finding.label,Number.isFinite(value) ? value : observed.amount,observed.unit,observed.period,finding.source.page,hashFor(finding),
      {f:`HYPERLINK("${pdf}#page=${finding.source.page}","#page=${finding.source.page}")`,v:'#page='+finding.source.page}]
  }
  const status = (row:number) => ({f:`IF(ABS(C${row})<0.0000001,"Reconciles","Variance")`,v:''})
  const analysis = analyzeLines(doc.lines)
  for (const rule of reconciliation(analysis)) {
    const first = rows.length+1
    rule.operands.forEach(({finding,sign})=>rows.push(line(rule.name+(sign<0 ? ' · less' : ' · add'),finding,sign)))
    const last = rows.length
    rows.push(line(rule.name+' · reported total',rule.total))
    const total = rows.length
    const cached = Number(rows[total-1][2])-rows.slice(first-1,last).reduce((sum,row)=>sum+Number(row[2]),0)
    rows.push([rule.name+' · variance',{...status(total+1),v:Math.abs(cached)<1e-7 ? 'Reconciles' : 'Variance'},{f:`C${total}-SUM(C${first}:C${last})`,v:Number(cached.toFixed(10))},rule.total.unit,rule.total.period])
  }
  const findings = workpaperFindings(analysis.items,doc.figures,doc.exclusions,doc.assignments)
  for (const tie of tieOuts(findings,doc.figures,doc.exclusions)) {
    rows.push(line('Tie-out · '+tie.metric,tie.a.finding))
    const a = rows.length
    rows.push(line('Tie-out · '+tie.metric,tie.b.finding))
    const b = rows.length
    const cached = Number(rows[a-1][2])-Number(rows[b-1][2])
    rows.push(['Tie-out · variance',{...status(b+1),v:tie.failed ? 'Variance' : 'Reconciles'},{f:`C${a}-C${b}`,v:Number(cached.toFixed(10))},tie.a.unit,tie.period])
  }
  if (rows.length===1) rows.push(['No arithmetic or cross-page checks were found in this workpaper.'])
  return rows
}
