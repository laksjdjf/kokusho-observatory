import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NationalRanking, NicheMousho, DatesIndex } from '../types'
import { useJson, Badge, StationLink, DateLink, tierRowStyle } from '../lib'

type Tab = 'alltime' | 'niche' | 'hotdays'

function AllTime({ ranking, codeOf }: { ranking: NationalRanking; codeOf: (n: string, p: string) => string | undefined }) {
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>順位</th><th>気温</th><th>地点</th><th>都道府県</th><th>観測日</th><th>区分</th></tr></thead>
        <tbody>
          {ranking.records.map((r, i) => (
            <tr key={`${r.station}-${r.date}-${i}`} className={`tier-${r.tier}`} style={tierRowStyle(r.tier)}>
              <td className="rank">{r.rank ?? '—'}</td>
              <td className="temp">{r.temp.toFixed(1)}℃</td>
              <td className="station">
                <StationLink code={codeOf(r.station, r.pref)}>{r.station}</StationLink>
                {r.relocated && <span className="note-star" title="移転・観測環境の変更等（気象庁の脚注）"> *</span>}
              </td>
              <td className="pref">{r.pref}</td>
              <td className="date"><DateLink date={r.date} /></td>
              <td className="tier-cell"><Badge tier={r.tier} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Niche({ niche }: { niche: NicheMousho }) {
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>順位</th><th>地点</th><th>都道府県</th><th>猛暑日 ≥35</th><th>酷暑日 ≥40</th><th>最長連続</th><th>最高</th></tr></thead>
        <tbody>
          {niche.records.map((r) => (
            <tr key={r.jma_code}>
              <td className="rank">{r.rank}</td>
              <td className="station"><StationLink code={r.jma_code}>{r.station}</StationLink></td>
              <td className="pref">{r.pref}</td>
              <td className="num-cell hot">{r.mousho.toLocaleString()}</td>
              <td className={`num-cell${r.kokusho ? ' kokusho' : ''}`}>{r.kokusho}</td>
              <td className="num-cell">{r.longest_streak}日</td>
              <td className="num-cell">{r.record_high}℃</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HotDays({ index }: { index: DatesIndex }) {
  const rows = useMemo(() => [...index.dates].sort((a, b) => b.max - a.max).slice(0, 150), [index])
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>順位</th><th>日付</th><th>全国最高</th><th>最高地点</th><th>猛暑日 地点数</th><th>酷暑日 地点数</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.date} className={`tier-${r.tier}`} style={tierRowStyle(r.tier)}>
              <td className="rank">{i + 1}</td>
              <td className="date"><DateLink date={r.date} /></td>
              <td className="temp">{r.max.toFixed(1)}℃</td>
              <td className="station">{r.top_pref} {r.top_station}</td>
              <td className="num-cell hot">{r.mousho}</td>
              <td className={`num-cell${r.kokusho ? ' kokusho' : ''}`}>{r.kokusho}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Rankings() {
  const { data: ranking } = useJson<NationalRanking>('data/national_all_time.json')
  const { data: niche } = useJson<NicheMousho>('data/niche_mousho.json')
  const { data: dates } = useJson<DatesIndex>('data/dates_index.json')
  const [tab, setTab] = useState<Tab>('alltime')
  const nav = useNavigate()

  const codeOf = useMemo(() => {
    const m = new Map<string, string>()
    niche?.records.forEach((r) => m.set(`${r.station}|${r.pref}`, r.jma_code))
    return (name: string, pref: string) => m.get(`${name}|${pref}`)
  }, [niche])

  return (
    <div className="page-wrap">
      <h1 className="page-title">ランキング</h1>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'alltime'} onClick={() => setTab('alltime')}>歴代全国 最高気温</button>
        <button className="tab" role="tab" aria-selected={tab === 'niche'} onClick={() => setTab('niche')}>歴代 猛暑日回数</button>
        <button className="tab" role="tab" aria-selected={tab === 'hotdays'} onClick={() => setTab('hotdays')}>暑かった日</button>
        <span style={{ flex: 1 }} />
        <label className="date-jump">
          日付で見る:
          <input type="date" onChange={(e) => e.target.value && nav(`/date/${e.target.value}`)} />
        </label>
      </div>

      {tab === 'alltime' && ranking && (
        <><p className="subhead">歴代全国（官署＋アメダス） ・ 日付/地点クリックで詳細 ・ 同着は同順位</p><AllTime ranking={ranking} codeOf={codeOf} /></>
      )}
      {tab === 'niche' && niche && (
        <><p className="subhead">{niche.meta.note} ・ 観測期間の長い地点が有利</p><Niche niche={niche} /></>
      )}
      {tab === 'hotdays' && dates && (
        <><p className="subhead">全国最高気温が高かった日 TOP150 ・ 日付クリックでその日の全国ランキング</p><HotDays index={dates} /></>
      )}
    </div>
  )
}
