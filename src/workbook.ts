import {strToU8,zipSync} from 'fflate'
import {findings} from './findings'
import type {RecordFile} from './register'

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
export function writeWorkbook(doc:RecordFile){
  const figures:(string|number)[][]=[['Metric','Value','Unit','Period','Source PDF','Page','Evidence','Reviewer note','Reviewed UTC']]
  for(const f of doc.figures)figures.push([f.label,f.amount.replace(/[^0-9]/g,'').length<=15?Number(f.amount):f.amount,f.unit,f.period,doc.name,f.source.page,f.source.text,f.note,f.saved])
  const evidence:(string|number)[][]=[['Metric','Extracted value','Unit','Period','Page','Evidence','Status']]
  for(const f of findings(doc.lines)){
    const reviewed=doc.figures.some(r=>r.source.page===f.source.page&&r.source.text===f.source.text)
    evidence.push([f.label,f.amount,f.unit,f.period,f.source.page,f.source.text,reviewed?'Reviewed':'Needs review'])
  }
  const parts:Record<string,string>={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+[1,2].map(i=>'<Override PartName="/xl/worksheets/sheet'+i+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
    '_rels/.rels':'<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets><sheet name="Reviewed figures" sheetId="1" r:id="rId1"/><sheet name="Document findings" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+packageRel+'">'+[1,2].map(i=>'<Relationship Id="rId'+i+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+i+'.xml"/>').join('')+'</Relationships>',
    'xl/worksheets/sheet1.xml':sheet(figures,[32,18,18,20,40,10,90,45,26]),
    'xl/worksheets/sheet2.xml':sheet(evidence,[30,18,18,16,10,100,18])
  }
  const bytes=zipSync(Object.fromEntries(Object.entries(parts).map(([name,value])=>[name,strToU8(value)])))
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const link=document.createElement('a');link.href=url;link.download=doc.name.replace(/\.pdf$/i,'')+'.xlsx';link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
