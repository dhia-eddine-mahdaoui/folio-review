import {strToU8,zipSync} from 'fflate'
import {findings} from './findings'
import {findingKey, findingStatus, workpaperFindings} from './review'
import type {Figure, RecordFile} from './register'

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
function sheet(rows:(string|number)[][],widths:number[]){
  const content=rows.map((row,index)=>{
    const cells=row.map((v,i)=>{
      const ref=column(i)+(index+1)
      if(typeof v==='number')return '<c r="'+ref+'"><v>'+v+'</v></c>'
      return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+escape(v.slice(0,32767))+'</t></is></c>'
    })
    return '<row r="'+(index+1)+'">'+cells.join('')+'</row>'
  })
  const cols=widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>')
  return '<worksheet xmlns="'+main+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+cols.join('')+'</cols><sheetData>'+content.join('')+'</sheetData></worksheet>'
}
export function writeWorkbook(doc:RecordFile,selected=doc.figures){
  const figures:(string|number)[][]=[['Metric','Value','Unit','Period','Source PDF','Page','Evidence','Reviewer note','Reviewed UTC','Original value','Original unit','Original period','Reviewer ID','Change reason']]
  const amount=(f:Figure)=>f.amount.replace(/[^0-9]/g,'').length<=15&&Number.isFinite(Number(f.amount))?Number(f.amount):f.amount
  for(const f of selected)figures.push([f.label,amount(f),f.unit,f.period,doc.name,f.source.page,f.source.text,f.note,f.saved,
    f.original?.amount??'',f.original?.unit??'',f.original?.period??'',f.reviewer??'',f.changeReason??''])
  const evidence:(string|number)[][]=[['Metric','Extracted value','Unit','Period','Page','Evidence','Status','Reason code','Details','Decided UTC','Reviewer ID','Assignee','Priority']]
  for (const f of workpaperFindings(findings(doc.lines),doc.figures,doc.exclusions,doc.assignments)) {
    const key = findingKey(f)
    const status = findingStatus(f, doc.figures, doc.exclusions)
    const decision = doc.exclusions?.[key]
    const assignment = doc.assignments?.[key]
    evidence.push([f.label,f.amount,f.unit,f.period,f.source.page,f.source.text,status,decision?.code ?? '',decision?.reason ?? '',
      decision?.reason ? decision.saved : '',decision?.reason ? decision.reviewer ?? '' : '',assignment?.assignee ?? '',assignment?.priority ?? 'Normal'])
  }
  const audit = [['Action','Reviewer ID','Reason','UTC','Original prediction','Before','After']]
  for (const event of [...(doc.history ?? [])].sort((a,b)=>b.saved.localeCompare(a.saved))) audit.push([
    event.action,event.reviewer,event.reason,event.saved,JSON.stringify(event.original) ?? '',
    JSON.stringify(event.ocr?.before ?? event.before) ?? '',JSON.stringify(event.ocr?.after ?? event.after) ?? '',
  ])
  const sheetNames = ['Reviewed figures','Document findings','Activity history']
  const sheetIds = sheetNames.map((_,index)=>index+1)
  const parts:Record<string,string>={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheetIds.map(i=>'<Override PartName="/xl/worksheets/sheet'+i+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
    '_rels/.rels':'<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets>'+sheetIds.map((id,index)=>'<sheet name="'+sheetNames[index]+'" sheetId="'+id+'" r:id="rId'+id+'"/>').join('')+'</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+packageRel+'">'+sheetIds.map(i=>'<Relationship Id="rId'+i+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+i+'.xml"/>').join('')+'</Relationships>',
    'xl/worksheets/sheet1.xml':sheet(figures,[32,18,18,20,40,10,90,45,26,18,18,20,24,45]),
    'xl/worksheets/sheet2.xml':sheet(evidence,[30,18,18,16,10,100,18,25,45,26,24,24,14]),
    'xl/worksheets/sheet3.xml':sheet(audit,[25,24,40,26,60,60,60])
  }
  const bytes=zipSync(Object.fromEntries(Object.entries(parts).map(([name,value])=>[name,strToU8(value)])))
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const link=document.createElement('a');link.href=url;link.download=doc.name.replace(/\.pdf$/i,'')+'.xlsx';link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
