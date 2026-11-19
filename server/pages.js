export async function readPages(task,ocr){
  try{
    const pdf=await task.promise
    if(pdf.numPages>150)throw Error('PDF exceeds 150 pages.')
    const pages=[]
    let size=0
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n)
      const rows=new Map()
      for(const item of (await page.getTextContent()).items){
        if(!item.str?.trim())continue
        const y=Math.round(item.transform[5]/2)
        if(!rows.has(y))rows.set(y,[])
        rows.get(y).push(item)
      }
      let text=[...rows].sort(([a],[b])=>b-a).map(([,items])=>items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str.trim()).join(' ')).join('\n')
      if(ocr&&text.trim().length<24)text=await ocr(page)||text
      size+=text.length
      if(size>1500000)throw Error('Extracted text exceeds 1.5 million characters.')
      pages.push(text);page.cleanup()
    }
    return pages
  }finally{await task.destroy()}
}
