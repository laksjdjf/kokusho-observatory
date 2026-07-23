import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { DailyLatest, NationalRanking, DatesIndex } from '../types'
import { useJson, Badge, StationLink, DateLink } from '../lib'

function Hero({ top }: { top: NationalRanking['records'][number] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => el.classList.add('is-hot')
    const off = () => el.classList.remove('is-hot')
    el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off)
    return () => { el.removeEventListener('pointerenter', on); el.removeEventListener('pointerleave', off) }
  }, [])
  return (
    <div className="hero-plaque" ref={ref}>
      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      <p className="hero-eyebrow">日本歴代最高気温 ・ 観測史上第1位</p>
      <div className="hero-readout"><span className="num">{top.temp.toFixed(1)}</span><span className="unit">℃</span></div>
      <Badge tier={top.tier} />
      <dl className="hero-meta">
        <div><dt>観測地点</dt><dd>{top.pref} {top.station}</dd></div>
        <div><dt>観測日</dt><dd><DateLink date={top.date}>{top.date_label}</DateLink></dd></div>
      </dl>
    </div>
  )
}

function TodayPanel({ daily }: { daily: DailyLatest }) {
  const top = daily.records[0]
  if (!top) return null
  return (
    <div className="panel today-panel">
      <div className="today-head">
        <h2 style={{ margin: 0 }}><span>直近観測日の全国最高</span></h2>
        <span className="today-date"><DateLink date={daily.meta.date} /> ・ {daily.meta.count}地点</span>
      </div>
      <div className="today-top">
        <span className="num">{top.temp.toFixed(1)}</span><span className="unit">℃</span>
        <span className="loc"><StationLink code={top.jma_code}>{top.pref} {top.station}</StationLink></span>
        <Badge tier={top.tier} />
      </div>
      <div className="mini-list">
        {daily.records.slice(1, 15).map((r) => (
          <div className="mini-row" key={r.jma_code}>
            <span className="mrank">{r.rank}</span>
            <span className="mtemp" style={{ color: `var(--t${r.tier})` }}>{r.temp.toFixed(1)}</span>
            <span className="mloc"><StationLink code={r.jma_code}>{r.station}</StationLink></span>
          </div>
        ))}
      </div>
      <Link to={`/date/${daily.meta.date}`} className="panel-more">この日の全国ランキングを見る →</Link>
    </div>
  )
}

const LEGEND = [
  { c: 'c1', name: <span>夏日</span>, range: '≥ 25.0℃' },
  { c: 'c2', name: <span>真夏日</span>, range: '≥ 30.0℃' },
  { c: 'c3', name: <span className="shimmer-text">猛暑日</span>, range: '≥ 35.0℃' },
  { c: 'c4', name: <span>酷暑日</span>, range: '≥ 40.0℃ ・ 2025年 気象庁定義' },
]

export default function Home() {
  const { data: ranking } = useJson<NationalRanking>('data/national_all_time.json')
  const { data: daily } = useJson<DailyLatest>('data/daily_latest.json')
  const { data: dates } = useJson<DatesIndex>('data/dates_index.json')

  return (
    <div className="page-wrap home">
      <div className="masthead-lg">
        <p className="eyebrow">全国気温観測記録 追跡ダッシュボード</p>
        <h1 className="brand">最高気温マニア <span className="brand-sub">— 酷暑オブザーバトリー —</span></h1>
        <p className="tagline">記録は、破られるために存在する。2025年、日本の空気は 41.8℃ に達した。</p>
      </div>

      <div className="home-grid">
        <section aria-label="歴代1位">{ranking?.records[0] && <Hero top={ranking.records[0]} />}</section>
        <section aria-label="直近の全国最高">{daily && <TodayPanel daily={daily} />}</section>
      </div>

      <section aria-label="カテゴリ凡例" className="legend-section">
        <h2><span>カテゴリ凡例</span><span className="h2-rule" /><span className="h2-tag">JMA CLASS</span></h2>
        <div className="legend-row">
          {LEGEND.map((l) => (
            <div className={`chip ${l.c}`} key={l.c}>
              <span className="chip-name"><span className="dot" />{l.name}</span>
              <span className="chip-range">{l.range}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="ナビゲーション" className="entry-cards">
        <Link to="/rankings" className="entry-card">
          <h3>ランキング</h3>
          <p>歴代全国 / 猛暑日回数 / 暑かった日</p>
        </Link>
        <Link to="/stations" className="entry-card">
          <h3>地点一覧</h3>
          <p>{daily ? '官署＋アメダス' : '—'} の記録を地点ごとに</p>
        </Link>
        <Link to="/map" className="entry-card">
          <h3>地図</h3>
          <p>全国分布ヒートマップ（特定日 / 歴代最高）</p>
        </Link>
        <div className="entry-card stat">
          <h3>{dates ? dates.meta.count.toLocaleString() : '—'}</h3>
          <p>収録している猛暑日（全国最高≥35℃）</p>
        </div>
      </section>
    </div>
  )
}
