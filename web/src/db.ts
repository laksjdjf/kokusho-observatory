/**
 * db.ts — ブラウザ内で Parquet に直接SQLを投げる層（DuckDB-WASM）。
 *
 * これまでは集計結果を全部ビルド時にJSON化していたため、新しい切り口を
 * 思いつくたびに Python 側の改修とCI再実行が必要だった。DuckDB-WASM なら
 * Parquet(19MB)をHTTPレンジで部分取得しながら任意のSQLを実行できるので、
 * 新しいランキングは「SQLを1本書く」だけで足りる。
 *
 * wasm/worker は外部CDNではなく自前でバンドルして同一オリジンから配る
 * （CDN障害に引きずられない・クロスオリジンWorkerの制約も回避できる）。
 * GitHub Pages は COOP/COEP を付けられないのでスレッド版(coi)は使わない。
 */
import * as duckdb from '@duckdb/duckdb-wasm'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

const BASE = import.meta.env.BASE_URL

// PC向け前提なので例外処理対応版(eh)のみ同梱する。
// mvpも入れるとwasmが41MB増えるだけで、現行ブラウザでは選ばれない。
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: ehWasm, mainWorker: ehWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/** 起動の進捗を画面に出すためのフック（デバッグ用） */
export let onStage: ((s: string) => void) | null = null
export function setStageHook(fn: (s: string) => void) { onStage = fn }
const stage = (s: string) => { onStage?.(s) }

async function init(): Promise<duckdb.AsyncDuckDB> {
  stage('バンドル選択中')
  const bundle = await duckdb.selectBundle(BUNDLES)
  stage('Worker起動中')
  const worker = new Worker(bundle.mainWorker!)
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
  stage('wasm初期化中')
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  stage('Parquet登録中')
  // Parquet は丸ごとDLせず、必要な範囲だけHTTPレンジ取得させる
  const origin = new URL(BASE, window.location.href).href
  for (const f of ['daily_max.parquet', 'stations.parquet']) {
    await db.registerFileURL(f, new URL(f, origin).href, duckdb.DuckDBDataProtocol.HTTP, false)
  }
  stage('準備完了')
  return db
}

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = init()
  return dbPromise
}

/** SQLを実行して行の配列で返す */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const db = await getDb()
  const con = await db.connect()
  try {
    const res = await con.query(sql)
    return res.toArray().map((r) => r.toJSON() as T)
  } finally {
    await con.close()
  }
}

export const DAILY = "read_parquet('daily_max.parquet')"
export const STATIONS = "read_parquet('stations.parquet')"
