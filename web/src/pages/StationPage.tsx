import { useParams, Link } from 'react-router-dom'
import type { StationDetail, Tier } from '../types'
import { useJson, DateLink } from '../lib'

function StatBox({ v, l, t }: { v: string | number; l: string; t?: Tier }) {
  return <div className={`stat-box${t ? ` t${t}` : ''}`}><div className="sv">{v}</div><div className="sl">{l}</div></div>
}

export default function StationPage() {
  const { code = '' } = useParams()
  const { data: d, error, loading } = useJson<StationDetail>(`data/station/${code}.json`)

  const maxYear = d ? Math.max(...d.yearly.map((y) => y.max), 40) : 40
  const minYear = d ? Math.min(...d.yearly.map((y) => y.max), 30) : 30

  return (
    <div className="page-wrap">
      {error && <p className="state">地点データが見つかりません（{code}）。<Link className="st-link" to="/stations">← 地点一覧へ</Link></p>}
      {loading && <p className="state">読み込み中…</p>}
      {d && (
        <>
          <div className="page-head">
            <p className="eyebrow">観測地点</p>
            <h1 className="page-title">
              {d.station.pref} {d.station.name}
              {d.station.name_kana && <span className="kana"> {d.station.name_kana}</span>}
            </h1>
            <p className="st-meta">
              観測開始 {d.station.obs_start ?? '—'} ・ 標高 {d.station.elevation ?? '—'}m ・
              {d.station.lat.toFixed(3)}, {d.station.lon.toFixed(3)} ・ 観測日数 {d.stats.days.toLocaleString()}日
            </p>
          </div>

          <div className="station-grid">
            <section className="station-stats">
              <h2><span>記録サマリー</span><span className="h2-rule" /></h2>
              <div className="stat-grid">
                <StatBox v={`${d.stats.record_high}℃`} l="観測史上最高" t={d.stats.record_high >= 40 ? 4 : 3} />
                <StatBox v={d.stats.kokusho.toLocaleString()} l="酷暑日 ≥40" t={4} />
                <StatBox v={d.stats.mousho.toLocaleString()} l="猛暑日 ≥35" t={3} />
                <StatBox v={d.stats.manatsu.toLocaleString()} l="真夏日 ≥30" t={2} />
                <StatBox v={d.stats.natsu.toLocaleString()} l="夏日 ≥25" t={1} />
                <StatBox v={`${d.stats.longest_mousho_streak}日`} l="最長連続猛暑日" t={3} />
              </div>
            </section>

            <section className="station-best">
              <h2><span>観測史上トップ10</span><span className="h2-rule" /></h2>
              <div className="best-list wide">
                {d.best.slice(0, 10).map((b, i) => (
                  <div className="best-item" key={i}>
                    <span className="bi-rank">{i + 1}</span>
                    <span className="bi-temp" style={{ color: `var(--t${b.tier})` }}>{b.temp.toFixed(1)}℃</span>
                    <span className="bi-date"><DateLink date={b.date} /></span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="station-yearly">
            <h2><span>年別 最高気温の推移</span><span className="h2-rule" /><span className="h2-tag">{d.yearly.length}年</span></h2>
            <div className="yearly tall">
              {d.yearly.map((y) => {
                const h = ((y.max - minYear) / (maxYear - minYear || 1)) * 100
                const c = y.max >= 40 ? 'var(--t4)' : y.max >= 35 ? 'var(--t3)' : y.max >= 30 ? 'var(--t2)' : 'var(--t1)'
                return (
                  <div className="ybar" key={y.year} style={{ height: `${Math.max(h, 3)}%`, ['--ybar-c' as string]: c }}>
                    <span className="ybar-tip">{y.year}年 {y.max}℃ / 猛暑{y.mousho}日{y.kokusho ? ` / 酷暑${y.kokusho}日` : ''}</span>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
