import { useParams, Link } from 'react-router-dom'
import type { DateDetail } from '../types'
import { useJson, Badge, StationLink, tierRowStyle, tierFor } from '../lib'

export default function DatePage() {
  const { date = '' } = useParams()
  const { data, error, loading } = useJson<DateDetail>(`data/date/${date}.json`)

  return (
    <div className="page-wrap">
      <div className="page-head">
        <p className="eyebrow">日付別 全国ランキング</p>
        <h1 className="page-title big-date">{date}</h1>
      </div>

      {error && (
        <p className="state">
          この日は全国で猛暑日(≥35℃)の記録がない、またはデータ対象範囲外です。<br />
          （対象＝全国最高が35℃以上の日 ＋ 直近120日 ／ 官署＋主要アメダス）<br />
          <Link className="st-link" to="/rankings">← ランキングへ戻る</Link>
        </p>
      )}
      {loading && <p className="state">読み込み中…</p>}

      {data && (
        <div className="date-grid">
          <aside className="date-summary">
            <div className="stat-grid">
              <div className={`stat-box t${tierFor(data.meta.national_max)}`}>
                <div className="sv">{data.meta.national_max.toFixed(1)}℃</div><div className="sl">全国最高</div>
              </div>
              <div className="stat-box t3"><div className="sv">{data.meta.mousho_count}</div><div className="sl">猛暑日 地点数</div></div>
              <div className="stat-box t4"><div className="sv">{data.meta.kokusho_count}</div><div className="sl">酷暑日 地点数</div></div>
              <div className="stat-box"><div className="sv">{data.meta.count}</div><div className="sl">観測地点数</div></div>
            </div>
            <p className="hint">
              地点名クリックでその地点の全記録へ。<br />
              <Link className="st-link" to={`/map?date=${date}`}>この日の分布を地図で見る →</Link>
            </p>
          </aside>

          <div className="date-table">
            <div className="table-scroll">
              <table>
                <thead><tr><th>順位</th><th>気温</th><th>地点</th><th>都道府県</th><th>区分</th></tr></thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r.jma_code} className={`tier-${r.tier}`} style={tierRowStyle(r.tier)}>
                      <td className="rank">{r.rank}</td>
                      <td className="temp">{r.temp.toFixed(1)}℃</td>
                      <td className="station"><StationLink code={r.jma_code}>{r.station}</StationLink></td>
                      <td className="pref">{r.pref}</td>
                      <td className="tier-cell"><Badge tier={r.tier} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
