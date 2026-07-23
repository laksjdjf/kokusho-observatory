import { useMemo, useState } from 'react'
import type { StationStats } from '../types'
import { useJson, StationLink } from '../lib'

interface Row {
  jma_code: string; name: string; pref: string; type: string
  obs_start: string | null; stats: StationStats
}
interface Summary { meta: { count: number; subset: string }; stations: Row[] }

type SortKey = 'record_high' | 'kokusho' | 'mousho' | 'longest_mousho_streak' | 'days'
const COLS: { key: SortKey; label: string }[] = [
  { key: 'record_high', label: '史上最高' },
  { key: 'kokusho', label: '酷暑日' },
  { key: 'mousho', label: '猛暑日' },
  { key: 'longest_mousho_streak', label: '最長連続' },
  { key: 'days', label: '観測日数' },
]

export default function StationsList() {
  const { data } = useJson<Summary>('data/stations_summary.json')
  const [sort, setSort] = useState<SortKey>('record_high')

  const rows = useMemo(() => {
    if (!data) return []
    return [...data.stations].sort((a, b) => b.stats[sort] - a.stats[sort])
  }, [data, sort])

  return (
    <div className="page-wrap">
      <h1 className="page-title">地点一覧</h1>
      {data && <p className="subhead">{data.meta.subset} ・ {data.meta.count}地点 ・ 見出しクリックで並べ替え ・ 地点名クリックで詳細</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>地点</th><th>都道府県</th><th>観測開始</th>
              {COLS.map((c) => (
                <th key={c.key} className={`sortable${sort === c.key ? ' active' : ''}`} onClick={() => setSort(c.key)}>
                  {c.label}{sort === c.key ? ' ▼' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tier = r.stats.record_high >= 40 ? 4 : r.stats.record_high >= 35 ? 3 : 2
              return (
                <tr key={r.jma_code} className={`tier-${tier}`} style={{ ['--tier-color' as string]: `var(--t${tier})` }}>
                  <td className="station"><StationLink code={r.jma_code}>{r.name}</StationLink></td>
                  <td className="pref">{r.pref}</td>
                  <td className="date">{r.obs_start ?? '—'}</td>
                  <td className="temp">{r.stats.record_high.toFixed(1)}℃</td>
                  <td className={`num-cell${r.stats.kokusho ? ' kokusho' : ''}`}>{r.stats.kokusho}</td>
                  <td className="num-cell hot">{r.stats.mousho.toLocaleString()}</td>
                  <td className="num-cell">{r.stats.longest_mousho_streak}日</td>
                  <td className="num-cell">{r.stats.days.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
