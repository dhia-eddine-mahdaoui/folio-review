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
      const viewport=page.getViewport({scale:1})
      let lines=[...rows].sort(([a],[b])=>b-a).map(([,items])=>{
        let offset=0
        const words=items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>{
          const text=item.str.trim(),start=offset
          offset+=text.length+1
          const [,,,,x,y]=item.transform
          const rect=[...viewport.convertToViewportPoint(x,y-item.height*.18),...viewport.convertToViewportPoint(x+item.width,y+item.height*.86)]
          const box=[Math.min(rect[0],rect[2])/viewport.width,Math.min(rect[1],rect[3])/viewport.height,Math.max(rect[0],rect[2])/viewport.width,Math.max(rect[1],rect[3])/viewport.height]
          return {text,start,end:offset-1,box}
        })
        return {page:n,text:words.map(w=>w.text).join(' '),words,box:[Math.min(...words.map(w=>w.box[0])),Math.min(...words.map(w=>w.box[1])),Math.max(...words.map(w=>w.box[2])),Math.max(...words.map(w=>w.box[3]))]}
      })
      let text=lines.map(l=>l.text).join('\n')
      if(ocr&&text.trim().length<24){
        const scanned=await ocr(page)
        if(scanned){text=scanned;lines=text.split(/\r?\n/).map(text=>({page:n,text:text.trim(),box:[0,0,0,0]}))}
      }
      size+=text.length
      if(size>1500000)throw Error('Extracted text exceeds 1.5 million characters.')
      pages.push({text,lines});page.cleanup()
    }
    return pages
  }finally{await task.destroy()}
}
