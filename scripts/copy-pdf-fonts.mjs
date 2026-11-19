import { cp } from 'node:fs/promises'
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/pdf-fonts', { recursive: true })
