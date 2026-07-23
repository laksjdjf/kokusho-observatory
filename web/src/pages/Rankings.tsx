import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NationalRanking } from '../types'
import { useJson, Badge, StationLink, DateLink, tierRowStyle, tierFor } from '../lib'
import { query, DAILY, STATIONS } from '../db'

/** Parquetへ直接SQLを投げる。新しい切り口は「SQLを1本書く」だけで足りる。 */
function useQuery<T>(sql: string) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setRows(null); setErr(null)
    query<T>(sql).then(setRows).catch((e) => setErr(String(e)))
  }, [sql])
  return { rows, err }
}

interface NicheRow { jma_code: string; name: string; pref: string; mousho: number; kokusho: number; longest: number; record_high: number }
interface HotDayRow { date: string; max: number; mousho: number; kokusho: number; top_name: string; top_pref: string }

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

const SQL_NICHE = `
  WITH agg AS (
    SELECT station_id,
           COUNT(*) FILTER (WHERE max_temp >= 35) AS mousho,
           COUNT(*) FILTER (WHERE max_temp >= 40) AS kokusho,
           MAX(max_temp) AS record_high
    FROM ${DAILY} GROUP BY station_id
  ),
  -- 連続猛暑日: 日付から連番を引くと連続区間が同じ値になる（島ID法）
  hot AS (
    SELECT station_id,
           date - CAST(row_number() OVER (PARTITION BY station_id ORDER BY date) AS INTEGER) AS grp
    FROM ${DAILY} WHERE max_temp >= 35
  ),
  streak AS (
    SELECT station_id, MAX(len) AS longest FROM (
      SELECT station_id, grp, COUNT(*) AS len FROM hot GROUP BY station_id, grp
    ) GROUP BY station_id
  )
  SELECT s.jma_code, s.name, s.pref,
         a.mousho, a.kokusho, a.record_high,
         COALESCE(st.longest, 0) AS longest
  FROM agg a
  JOIN ${STATIONS} s ON s.id = a.station_id
  LEFT JOIN streak st ON st.station_id = a.station_id
  ORDER BY a.mousho DESC`

function Niche() {
  const { rows: niche, err } = useQuery<NicheRow>(SQL_NICHE)
  if (err) return <p className="state">集計に失敗しました: {err}</p>
  if (!niche) return <p className="state">集計中…（初回はDBの起動に数秒かかります）</p>
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>順位</th><th>地点</th><th>都道府県</th><th>猛暑日 ≥35</th><th>酷暑日 ≥40</th><th>最長連続</th><th>最高</th></tr></thead>
        <tbody>
          {niche.map((r, i) => (
            <tr key={r.jma_code}>
              <td className="rank">{i + 1}</td>
              <td className="station"><StationLink code={r.jma_code}>{r.name}</StationLink></td>
              <td className="pref">{r.pref}</td>
              <td className="num-cell hot">{Number(r.mousho).toLocaleString()}</td>
              <td className={`num-cell${Number(r.kokusho) ? ' kokusho' : ''}`}>{Number(r.kokusho)}</td>
              <td className="num-cell">{Number(r.longest)}日</td>
              <td className="num-cell">{r.record_high.toFixed(1)}℃</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SQL_HOTDAYS = `
  WITH per_day AS (
    SELECT d.date,
           MAX(d.max_temp) AS max,
           COUNT(*) FILTER (WHERE d.max_temp >= 35) AS mousho,
           COUNT(*) FILTER (WHERE d.max_temp >= 40) AS kokusho,
           arg_max(s.name, d.max_temp) AS top_name,
           arg_max(s.pref, d.max_temp) AS top_pref
    FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
    GROUP BY d.date
  )
  SELECT strftime(date, '%Y-%m-%d') AS date, max, mousho, kokusho, top_name, top_pref
  FROM per_day ORDER BY max DESC LIMIT 150`

function HotDays() {
  const { rows, err } = useQuery<HotDayRow>(SQL_HOTDAYS)
  if (err) return <p className="state">集計に失敗しました: {err}</p>
  if (!rows) return <p className="state">集計中…（初回はDBの起動に数秒かかります）</p>
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>順位</th><th>日付</th><th>全国最高</th><th>最高地点</th><th>猛暑日 地点数</th><th>酷暑日 地点数</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.date} className={`tier-${tierFor(r.max)}`} style={tierRowStyle(tierFor(r.max))}>
              <td className="rank">{i + 1}</td>
              <td className="date"><DateLink date={r.date} /></td>
              <td className="temp">{Number(r.max).toFixed(1)}℃</td>
              <td className="station">{r.top_pref} {r.top_name}</td>
              <td className="num-cell hot">{Number(r.mousho)}</td>
              <td className={`num-cell${Number(r.kokusho) ? ' kokusho' : ''}`}>{Number(r.kokusho)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Rankings() {
  const { data: ranking } = useJson<NationalRanking>('data/national_all_time.json')
  const [tab, setTab] = useState<Tab>('alltime')
  const nav = useNavigate()

  // 歴代ランキング(rankall由来)には地点コードが無いので、地点マスタから引く
  const { rows: stationIdx } = useQuery<{ jma_code: string; name: string; pref: string }>(
    `SELECT jma_code, name, pref FROM ${STATIONS}`)
  const codeOf = useMemo(() => {
    const m = new Map<string, string>()
    stationIdx?.forEach((r) => m.set(`${r.name}|${r.pref}`, r.jma_code))
    return (name: string, pref: string) => m.get(`${name}|${pref.replace(/[都道府県]$/, '')}`)
  }, [stationIdx])

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
      {tab === 'niche' && (
        <><p className="subhead">地点別 歴代 猛暑日(≥35℃)日数 ・ 観測期間の長い地点が有利 ・ その場で集計</p><Niche /></>
      )}
      {tab === 'hotdays' && (
        <><p className="subhead">全国最高気温が高かった日 TOP150 ・ 日付クリックでその日の全国ランキング ・ その場で集計</p><HotDays /></>
      )}
    </div>
  )
}
