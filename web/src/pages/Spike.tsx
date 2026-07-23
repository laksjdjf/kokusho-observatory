import { useEffect, useState } from 'react'
import { query, DAILY, STATIONS, setStageHook } from '../db'

/** DuckDB-WASM の実地検証用ページ。任意SQLが本当に通るかを確かめる。 */
export default function Spike() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [ms, setMs] = useState<number[]>([])
  const [stage, setStage] = useState('開始前')

  useEffect(() => {
    setStageHook(setStage)
    ;(async () => {
      try {
        const t0 = performance.now()
        // 事前計算JSONを一切使わず、その場で「歴代猛暑日回数ランキング」を集計する
        const r = await query(`
          SELECT s.name, s.pref,
                 COUNT(*) FILTER (WHERE d.max_temp >= 35) AS mousho,
                 COUNT(*) FILTER (WHERE d.max_temp >= 40) AS kokusho,
                 MAX(d.max_temp) AS record_high
          FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
          GROUP BY s.name, s.pref
          ORDER BY mousho DESC
          LIMIT 8
        `)
        const t1 = performance.now()
        setRows(r)
        setMs([Math.round(t1 - t0)])
      } catch (e) {
        setErr(String(e))
        setStage("失敗")
      }
    })()
  }, [])

  return (
    <div className="page-wrap">
      <h1 className="page-title">DuckDB-WASM 検証</h1>
      {err && <p className="state">エラー: {err}</p>}
      {!rows.length && !err && <p className="state">DuckDB: {stage} …</p>}
      {rows.length > 0 && (
        <>
          <p className="subhead">
            事前計算JSONを使わず、ブラウザからParquetに直接SQLを実行 ・ 所要 {ms[0]}ms
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>地点</th><th>都道府県</th><th>猛暑日</th><th>酷暑日</th><th>最高</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="station">{String(r.name)}</td>
                    <td className="pref">{String(r.pref)}</td>
                    <td className="num-cell hot">{String(r.mousho)}</td>
                    <td className="num-cell kokusho">{String(r.kokusho)}</td>
                    <td className="temp">{Number(r.record_high).toFixed(1)}℃</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
