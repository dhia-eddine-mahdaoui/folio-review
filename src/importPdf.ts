import { getDocument, Util } from 'pdfjs-dist'
import type { Metric, Review } from './model'

const fields = [
  ['revenue', 'Revenue', 'revenue|net sales'],
  ['ebitda', 'Adjusted EBITDA', 'adjusted ebitda'],
  ['debt', 'Net debt', 'net debt'],
  ['cash', 'Free cash flow', 'free cash flow'],
] as const

export async function importPdf(file: File, year: string, progress: (message: string) => void): Promise<Review> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a PDF smaller than 20 MB.')
  const task = getDocument({ data: await file.arrayBuffer(), standardFontDataUrl: '/pdf-fonts/' })
  try {
    const pdf = await task.promise
    if (pdf.numPages > 500) throw new Error('Choose a PDF with up to 500 pages.')
    const metrics: Metric[] = fields.map(([id, name]) => ({ id, name, unit: 'GBP m', period: 'FY' + year, status: 'missing', reason: '', evidence: [] }))
    const patterns = fields.map(([, , alias]) => new RegExp('^(?:FY\\s*)?' + year + '\\s+(actual|reported|provisional|forecast)\\s+(?:' + alias + ')\\s*[:-]\\s*(?:£|GBP\\s*)(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*(?:m|million)(?:\\s+GBP)?[.;]?$', 'i'))
    let textPages = 0
    for (let n = 1; n <= pdf.numPages; n++) {
      if (n === 1 || n % 10 === 0) progress('Reading page ' + n + ' of ' + pdf.numPages)
      const page = await pdf.getPage(n)
      const view = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const lines = new Map<string, { text: string; boxes: number[][] }>()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const key = String(Math.round(item.transform[5] * 2))
        const line = lines.get(key) ?? {text: '', boxes: []}
        line.text = (line.text + ' ' + item.str.trim()).trim()
        const [,,, , x, y] = item.transform
        const bounds = [...view.convertToViewportPoint(x, y - item.height * .2), ...view.convertToViewportPoint(x + item.width, y + item.height * .85)]
        line.boxes.push(Util.normalizeRect(bounds))
        lines.set(key, line)
      }
      if (lines.size) textPages++
      for (const {text, boxes} of lines.values()) {
        patterns.forEach((pattern, i) => {
          const match = text.match(pattern)
          if (!match) return
          const box: [number,number,number,number] = [Math.min(...boxes.map(b => b[0])) / view.width, Math.min(...boxes.map(b => b[1])) / view.height, Math.max(...boxes.map(b => b[2])) / view.width, Math.max(...boxes.map(b => b[3])) / view.height]
          metrics[i].evidence.push({page: n, quote: text, basis: match[1].toLowerCase(), value: match[2].replaceAll(',', ''), box})
        })
      }
      page.cleanup()
    }
    for (const metric of metrics) {
      const values = new Set(metric.evidence.filter(e => e.basis !== 'forecast').map(e => Number(e.value)))
      metric.status = !metric.evidence.length ? 'missing' : values.size > 1 ? 'conflict' : metric.evidence.some(e => ['actual','reported'].includes(e.basis)) ? 'ready' : 'limited'
      metric.reason = {missing:'No matching source was found for this period and unit.', conflict:'Compare the reporting bases and record why you chose one.', ready:'Check the highlighted line before approving.', limited:'Only provisional or forecast evidence was found.'}[metric.status]
    }
    return {title: file.name.replace(/\.pdf$/i,''), filename: file.name, pages:pdf.numPages, text_pages:textPages, metrics}
  } finally { await task.destroy() }
}
