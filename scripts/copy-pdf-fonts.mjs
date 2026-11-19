import { cp } from 'node:fs/promises'
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/pdf-fonts', { recursive: true })
import { mkdir } from 'node:fs/promises'
await mkdir('dist/ocr',{recursive:true})
for(const [src,name] of [
 ['tesseract.js/dist/worker.min.js','worker.min.js'],
 ['tesseract.js-core/tesseract-core-lstm.wasm.js','tesseract-core-lstm.wasm.js'],
 ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','eng.traineddata.gz']
])await cp('node_modules/'+src,'dist/ocr/'+name)
