import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NationalRanking } from '../types'
import { useJson, Badge, StationLink, DateLink, tierRowStyle, tierFor } from '../lib'
import { query, STATIONS } from '../db'
import { RANKINGS } from '../rankings'
import type { ColumnDef, RankingDef, RankingRow } from '../rankings'

/** Parquetへ直接SQLを投げる。新しい切り口は rankings.ts に「SQLを1本書く」だけで足りる。 */
function useQuery<T>(sql: string | null) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!sql) { setRows(null); setErr(null); return }
    setRows(null); setErr(null)
    query<T>(sql).then(setRows).catch((e) => setErr(String(e)))
  }, [sql])
  return { rows, err }
}

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

/** 列種別ごとの td クラス。styles.css の既存クラスに合わせる。 */
function cellClass(c: ColumnDef, r: RankingRow): string {
  switch (c.kind) {
    case 'rank': return 'rank'
    case 'station': return 'station'
    case 'pref': return 'pref'
    case 'date': return 'date'
    case 'temp': return 'temp'
    case 'int': {
      let cls = 'num-cell'
      if (c.tone === 'hot') cls += ' hot'
      if (c.tone === 'kokusho' && Number(r[c.key] ?? 0) > 0) cls += ' kokusho'
      return cls
    }
    default: return ''
  }
}

/** 列種別ごとの表示内容。BigIntで返ってくる集計値はNumber()で吸収する。 */
function renderCell(c: ColumnDef, r: RankingRow, i: number): ReactNode {
  const v = r[c.key]
  switch (c.kind) {
    case 'rank':
      return i + 1
    case 'station':
      return <StationLink code={r[c.codeKey ?? 'jma_code'] as string | undefined}>{String(v ?? '—')}</StationLink>
    case 'pref':
      return v == null ? '—' : String(v)
    case 'date':
      return <DateLink date={v as string | null} />
    case 'temp':
      return v == null ? '—' : `${Number(v).toFixed(1)}℃`
    case 'int':
      return v == null ? '—' : `${Number(v).toLocaleString()}${c.suffix ?? ''}`
    case 'text':
    default:
      return v === null || v === undefined || v === '' ? '—' : `${v}${c.suffix ?? ''}`
  }
}

function RankingTable({ def, rows }: { def: RankingDef; rows: RankingRow[] }) {
  const tempCol = useMemo(() => def.columns.find((c) => c.kind === 'temp'), [def])
  return (
    <div className="table-scroll">
      <table>
        <thead><tr>{def.columns.map((c) => <th key={c.header}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const tier = tempCol ? tierFor(Number(tempCol && r[tempCol.key])) : undefined
            const key = def.rowKey ? def.rowKey(r, i) : i
            return (
              <tr key={key} className={tier !== undefined ? `tier-${tier}` : undefined} style={tier !== undefined ? tierRowStyle(tier) : undefined}>
                {def.columns.map((c) => <td key={c.header} className={cellClass(c, r)}>{renderCell(c, r, i)}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type TabId = 'alltime' | string

export default function Rankings() {
  const { data: ranking } = useJson<NationalRanking>('data/national_all_time.json')
  const [tab, setTab] = useState<TabId>('alltime')
  const nav = useNavigate()

  // 歴代ランキング(rankall由来)には地点コードが無いので、地点マスタから引く
  const { rows: stationIdx } = useQuery<{ jma_code: string; name: string; pref: string }>(
    `SELECT jma_code, name, pref FROM ${STATIONS}`)
  const codeOf = useMemo(() => {
    const m = new Map<string, string>()
    stationIdx?.forEach((r) => m.set(`${r.name}|${r.pref}`, r.jma_code))
    return (name: string, pref: string) => m.get(`${name}|${pref.replace(/[都道府県]$/, '')}`)
  }, [stationIdx])

  const activeDef = RANKINGS.find((d) => d.id === tab)
  const { rows, err } = useQuery<RankingRow>(activeDef?.sql ?? null)

  return (
    <div className="page-wrap">
      <h1 className="page-title">ランキング</h1>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'alltime'} onClick={() => setTab('alltime')}>気象庁公式 歴代全国</button>
        {RANKINGS.map((d) => (
          <button key={d.id} className="tab" role="tab" aria-selected={tab === d.id} onClick={() => setTab(d.id)}>{d.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <label className="date-jump">
          日付で見る:
          <input type="date" onChange={(e) => e.target.value && nav(`/date/${e.target.value}`)} />
        </label>
      </div>

      {tab === 'alltime' && ranking && (
        <><p className="subhead">歴代全国（官署＋アメダス） ・ 日付/地点クリックで詳細 ・ 同着は同順位</p><AllTime ranking={ranking} codeOf={codeOf} /></>
      )}

      {activeDef && (
        <>
          <p className="subhead">{typeof activeDef.desc === 'function' ? (rows ? activeDef.desc(rows) : '') : activeDef.desc}</p>
          {err && <p className="state">集計に失敗しました: {err}</p>}
          {!err && !rows && <p className="state">集計中…（初回はDBの起動に数秒かかります）</p>}
          {!err && rows && <RankingTable def={activeDef} rows={rows} />}
        </>
      )}
    </div>
  )
}
