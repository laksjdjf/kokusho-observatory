import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { query, DAILY, STATIONS } from '../db'
import { Badge, StationLink, tierRowStyle, tierFor } from '../lib'
import type { Tier } from '../types'

interface Row {
  jma_code: string; name: string; pref: string; temp: number; max_temp_time: string | null
}

/**
 * 日付別の全国ランキング。
 * 以前は日付ごとに事前生成したJSON（4,993ファイル/59MB）を読んでいたが、
 * Parquet へ直接SQLを投げる方式に変えた。対象日を「猛暑日があった日」に
 * 絞る必要もなくなり、収録期間のどの日でも開ける。
 */
export default function DatePage() {
  const { date = '' } = useParams()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setRows(null); setErr(null)
    query<Row>(`
      SELECT s.jma_code, s.name, s.pref, d.max_temp AS temp, d.max_temp_time
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      WHERE d.date = DATE '${date.replace(/'/g, '')}'
      ORDER BY d.max_temp DESC
    `).then(setRows).catch((e) => setErr(String(e)))
  }, [date])

  const nationalMax = rows?.length ? rows[0].temp : null
  const mousho = rows?.filter((r) => r.temp >= 35).length ?? 0
  const kokusho = rows?.filter((r) => r.temp >= 40).length ?? 0

  return (
    <div className="page-wrap">
      <div className="page-head">
        <p className="eyebrow">日付別 全国ランキング</p>
        <h1 className="page-title big-date">{date}</h1>
      </div>

      {err && <p className="state">クエリに失敗しました: {err}</p>}
      {!rows && !err && <p className="state">集計中…（初回はDBの起動に数秒かかります）</p>}
      {rows && rows.length === 0 && (
        <p className="state">
          この日の観測データは収録されていません。<br />
          <Link className="st-link" to="/rankings">← ランキングへ戻る</Link>
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="date-grid">
          <aside className="date-summary">
            <div className="stat-grid">
              <div className={`stat-box t${tierFor(nationalMax!)}`}>
                <div className="sv">{nationalMax!.toFixed(1)}℃</div><div className="sl">全国最高</div>
              </div>
              <div className="stat-box t3"><div className="sv">{mousho}</div><div className="sl">猛暑日 地点数</div></div>
              <div className="stat-box t4"><div className="sv">{kokusho}</div><div className="sl">酷暑日 地点数</div></div>
              <div className="stat-box"><div className="sv">{rows.length}</div><div className="sl">観測地点数</div></div>
            </div>
            <p className="hint">
              地点名クリックでその地点の全記録へ。<br />
              <Link className="st-link" to={`/map?date=${date}`}>この日の分布を地図で見る →</Link>
            </p>
          </aside>

          <div className="date-table">
            <div className="table-scroll">
              <table>
                <thead><tr><th>順位</th><th>気温</th><th>起時</th><th>地点</th><th>都道府県</th><th>区分</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const tier: Tier = tierFor(r.temp)
                    return (
                      <tr key={r.jma_code} className={`tier-${tier}`} style={tierRowStyle(tier)}>
                        <td className="rank">{i + 1}</td>
                        <td className="temp">{r.temp.toFixed(1)}℃</td>
                        <td className="date">{r.max_temp_time ?? '—'}</td>
                        <td className="station"><StationLink code={r.jma_code}>{r.name}</StationLink></td>
                        <td className="pref">{r.pref}</td>
                        <td className="tier-cell"><Badge tier={tier} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
