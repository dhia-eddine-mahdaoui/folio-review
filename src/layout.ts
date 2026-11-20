import type {Line} from './register'

type Cell = {text:string; row:number; column:number; span:number; box:Line['box']}
type Table = {page:number; cells:Cell[]}
const simplify = (text:string) => text.replace(/[\s$€£]/g,'')

export function applyLayout(lines:Line[], tables:Table[]) {
  const byPage = new Map<number,Line[]>()
  for (const line of lines) {
    const page = byPage.get(line.page) ?? []
    page.push(line)
    byPage.set(line.page,page)
  }
  for (const [index,table] of tables.entries()) {
    const page = byPage.get(table.page)
    if (!page || !Array.isArray(table.cells)) continue
    const rows = new Map<number,Cell[]>()
    for (const cell of table.cells) {
      if (!cell.text || !Array.isArray(cell.box) || cell.box.length!==4 ||
        !cell.box.every(value=>Number.isFinite(value) && value>=0 && value<=1) ||
        !Number.isSafeInteger(cell.row) || !Number.isSafeInteger(cell.column) || !Number.isSafeInteger(cell.span)) continue
      const row = rows.get(cell.row) ?? []
      row.push(cell)
      rows.set(cell.row,row)
    }
    for (const cells of rows.values()) {
      cells.sort((a,b)=>a.column-b.column)
      const text = cells.map(cell=>cell.text).join(' ')
      const bounding:Line['box'] = [Math.min(...cells.map(cell=>cell.box[0])),Math.min(...cells.map(cell=>cell.box[1])),
        Math.max(...cells.map(cell=>cell.box[2])),Math.max(...cells.map(cell=>cell.box[3]))]
      const matched = page.findIndex(line=>simplify(line.text)===simplify(text) &&
        line.box[1]<bounding[3] && line.box[3]>bounding[1])
      if (matched<0) continue
      let offset = 0
      const words = cells.map(cell=>{
        const start=offset
        offset+=cell.text.length+1
        return {text:cell.text,start,end:offset-1,box:cell.box,grid:{id:index,column:cell.column,span:cell.span}}
      })
      page[matched] = {...page[matched],layoutText:text,words,box:bounding}
    }
  }
  return [...byPage.values()].flat()
}
