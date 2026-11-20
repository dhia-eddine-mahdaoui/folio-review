import sqliteInit from '@sqlite.org/sqlite-wasm'

const sqlite = sqliteInit()
type Pool = Awaited<ReturnType<Awaited<typeof sqlite>['installOpfsSAHPoolVfs']>>
let pool:Pool
const schema = `
  CREATE TABLE IF NOT EXISTS workpapers (
    id TEXT PRIMARY KEY, header TEXT NOT NULL, record TEXT NOT NULL, pdf BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS figures (
    workpaper_id TEXT NOT NULL REFERENCES workpapers(id) ON DELETE CASCADE,
    id TEXT NOT NULL, saved TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workpaper_id,id)
  );
  CREATE INDEX IF NOT EXISTS figures_saved ON figures(saved DESC);
  CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
`

self.onmessage = async ({data:{id,operation,key,header,record,pdf,figures,query,source}}) => {
  let db:InstanceType<Pool['OpfsSAHPoolDb']> | undefined
  let result:unknown
  let error:unknown
  try {
    const engine = await sqlite
    pool ??= await engine.installOpfsSAHPoolVfs({directory:'.folio-2',preserveOnInitFailure:true})
    if (pool.isPaused()) await pool.unpauseVfs()
    db = new pool.OpfsSAHPoolDb('/workpapers.sqlite3')
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(schema)
    switch (operation) {
      case 'headers': result=db.selectValues('SELECT header FROM workpapers'); break
      case 'get': result=db.selectObject('SELECT record,pdf FROM workpapers WHERE id=?',[key]); break
      case 'register': {
        const filter = source ? 'AND f.workpaper_id=?' : ''
        result = db.selectObjects(`SELECT w.id, json_extract(w.header,'$.name') AS document, f.payload FROM figures f
          JOIN workpapers w ON w.id=f.workpaper_id
          WHERE COALESCE(json_extract(w.header,'$.sample'),0)=0 ${filter} AND (
            ?='' OR instr(lower(json_extract(w.header,'$.name') || ' ' ||
              json_extract(f.payload,'$.label') || ' ' || coalesce(json_extract(f.payload,'$.verbatimLabel'),'') || ' ' ||
              json_extract(f.payload,'$.amount') || ' ' || json_extract(f.payload,'$.unit') || ' ' ||
              json_extract(f.payload,'$.period')),?)>0
          ) ORDER BY f.saved DESC`,source ? [source,query,query] : [query,query])
        break
      }
      case 'history': result=db.selectObjects(`SELECT id,json_extract(header,'$.name') AS document,
        json_extract(record,'$.history') AS history FROM workpapers WHERE coalesce(json_extract(header,'$.sample'),0)=0`); break
      case 'migrated': result=db.selectValue("SELECT name FROM migrations WHERE name='indexeddb'"); break
      case 'finish-migration': db.exec("INSERT OR IGNORE INTO migrations VALUES ('indexeddb')"); break
      case 'delete': db.exec({sql:'DELETE FROM workpapers WHERE id=?',bind:[key]}); break
      case 'put':
        db.transaction(tx=>{
          if (pdf) tx.exec({sql:`INSERT INTO workpapers VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            header=excluded.header,record=excluded.record`,bind:[key,header,record,new Uint8Array(pdf)]})
          else tx.exec({sql:'UPDATE workpapers SET header=?,record=? WHERE id=?',bind:[header,record,key]})
          tx.exec({sql:'DELETE FROM figures WHERE workpaper_id=?',bind:[key]})
          for (const figure of figures) {
            tx.exec({sql:'INSERT INTO figures VALUES (?,?,?,?)',bind:[key,figure.id,figure.saved,JSON.stringify(figure)]})
          }
        })
        break
      default: throw Error('Unknown storage operation.')
    }
  } catch (cause) {
    error = cause
  } finally {
    try {
      db?.close()
      if (pool && !pool.isPaused()) pool.pauseVfs()
    } catch (cause) {
      error ??= cause
    }
  }
  if (error!==undefined) self.postMessage({id,error:error instanceof Error ? error.message : String(error)})
  else self.postMessage({id,result})
}
