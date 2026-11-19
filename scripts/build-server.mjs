import {build} from 'esbuild'
import {mkdir,cp,rename,readdir} from 'node:fs/promises'
const assets=await readdir('dist')
await mkdir('dist/client',{recursive:true})
for(const name of assets)await rename('dist/'+name,'dist/client/'+name)
await build({entryPoints:['server/worker.js'],bundle:true,minify:true,format:'esm',target:'es2022',platform:'browser',outfile:'dist/server/index.js',loader:{'.html':'text'},external:['node:*']})
await mkdir('dist/.openai',{recursive:true})
await cp('.openai/hosting.json','dist/.openai/hosting.json')
