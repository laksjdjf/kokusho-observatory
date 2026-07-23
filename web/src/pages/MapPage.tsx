import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { geoMercator, geoPath } from 'd3-geo'
import type { DateDetail, DatesIndex, StationStats, Tier } from '../types'
import { useJson, tierFor, Badge } from '../lib'

// 日本は南西〜北東に伸びるので、投影後の比率に近い縦長のビューボックスにして余白を減らす
const W = 660
const H = 780

interface SumRow {
  jma_code: string; name: string; pref: string
  lat: number; lon: number; obs_start: string | null; stats: StationStats
}
interface Summary { meta: { count: number }; stations: SumRow[] }

type Mode = 'date' | 'alltime'

interface Plot {
  code: string; name: string; pref: string
  x: number; y: number; temp: number; tier: Tier
}

export default function MapPage() {
  const { data: geo } = useJson<GeoJSON.FeatureCollection>('japan.geojson')
  const { data: summary } = useJson<Summary>('data/stations_summary.json')
  const { data: index } = useJson<DatesIndex>('data/dates_index.json')

  // 表示状態はURLに持たせて共有可能にする（?mode=alltime&date=2025-08-05）
  const [params, setParams] = useSearchParams()
  const mode = (params.get('mode') === 'alltime' ? 'alltime' : 'date') as Mode
  const date = params.get('date')
  const setMode = (m: Mode) => {
    const p = new URLSearchParams(params)
    m === 'alltime' ? p.set('mode', 'alltime') : p.delete('mode')
    setParams(p, { replace: true })
  }
  const setDate = (d: string | null) => {
    const p = new URLSearchParams(params)
    d ? p.set('date', d) : p.delete('date')
    setParams(p, { replace: true })
  }
  const effDate = date ?? index?.meta.latest ?? null
  const { data: dayData } = useJson<DateDetail>(
    effDate && mode === 'date' ? `data/date/${effDate}.json` : 'data/dates_index.json',
  )

  const [hover, setHover] = useState<Plot | null>(null)
  const nav = useNavigate()

  // ---- パン & ズーム（自前実装）----
  // 点の半径は 1/k で打ち消すので、拡大すると「点が太る」のではなく「密集がほどける」。
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ active: boolean; moved: number } | null>(null)
  const K_MIN = 1, K_MAX = 14

  const toViewBox = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((clientX - r.left) / r.width) * W, ((clientY - r.top) / r.height) * H] as const
  }

  const zoomAt = (px: number, py: number, factor: number) => {
    setView((v) => {
      const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor))
      if (k === v.k) return v
      const s = k / v.k
      let x = px - (px - v.x) * s
      let y = py - (py - v.y) * s
      if (k === 1) { x = 0; y = 0 }
      return { k, x, y }
    })
  }

  // ホイールでページがスクロールしないよう native listener（passive:false）で拾う
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = toViewBox(e.clientX, e.clientY)
      zoomAt(px, py, e.deltaY < 0 ? 1.18 : 1 / 1.18)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { active: true, moved: 0 }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current?.active) return
    const r = svgRef.current!.getBoundingClientRect()
    const dx = (e.movementX / r.width) * W
    const dy = (e.movementY / r.height) * H
    drag.current.moved += Math.abs(e.movementX) + Math.abs(e.movementY)
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const endDrag = () => { if (drag.current) drag.current.active = false }
  /** ドラッグ後の誤クリックで地点ページへ飛ばないようにする */
  const clickIfNotDragged = (fn: () => void) => () => { if ((drag.current?.moved ?? 0) < 5) fn() }
  const reset = () => setView({ k: 1, x: 0, y: 0 })

  // 投影とパス（日本全体にフィット）
  const { pathD, project } = useMemo(() => {
    if (!geo) return { pathD: [] as string[], project: null as ((c: [number, number]) => [number, number] | null) | null }
    const proj = geoMercator().fitSize([W, H], geo as never)
    const gp = geoPath(proj)
    return {
      pathD: (geo.features ?? []).map((f) => gp(f as never) ?? ''),
      project: (c: [number, number]) => proj(c),
    }
  }, [geo])

  // 地点プロット（モードで気温ソースを切替）
  const plots: Plot[] = useMemo(() => {
    if (!summary || !project) return []
    const byCode = new Map(summary.stations.map((s) => [s.jma_code, s]))
    const rows: { code: string; temp: number }[] =
      mode === 'alltime'
        ? summary.stations.map((s) => ({ code: s.jma_code, temp: s.stats.record_high }))
        : (dayData?.records ?? []).map((r) => ({ code: r.jma_code, temp: r.temp }))

    const out: Plot[] = []
    for (const r of rows) {
      const s = byCode.get(r.code)
      if (!s) continue
      const p = project([s.lon, s.lat])
      if (!p) continue
      out.push({ code: s.jma_code, name: s.name, pref: s.pref, x: p[0], y: p[1], temp: r.temp, tier: tierFor(r.temp) })
    }
    // 熱い順に後ろへ描く（熱い点が上に重なる）
    return out.sort((a, b) => a.temp - b.temp)
  }, [summary, project, mode, dayData])

  const top = useMemo(() => [...plots].sort((a, b) => b.temp - a.temp).slice(0, 10), [plots])
  const counts = useMemo(() => ({
    kokusho: plots.filter((p) => p.tier === 4).length,
    mousho: plots.filter((p) => p.tier === 3).length,
  }), [plots])

  const radius = (t: Tier) => (t === 4 ? 7 : t === 3 ? 5.5 : t === 2 ? 4 : 3)

  return (
    <div className="page-wrap">
      <div className="page-head">
        <p className="eyebrow">全国分布</p>
        <h1 className="page-title">地図ヒートマップ</h1>
      </div>

      <div className="map-layout">
        <div className="map-stage">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
            className={`japan-map${drag.current?.active ? ' grabbing' : ''}`}
            role="img" aria-label="日本の観測地点分布"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={endDrag} onPointerLeave={endDrag}>
            <defs>
              <filter id="dotGlow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation={6 / view.k} result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <g className="japan-land">
                {pathD.map((d, i) => <path key={i} d={d} />)}
              </g>
              <g className="stations">
                {plots.map((p) => (
                  <g key={p.code} className={`dot tier-${p.tier}`}
                    onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                    onClick={clickIfNotDragged(() => nav(`/station/${p.code}`))}>
                    <title>{p.pref} {p.name} {p.temp.toFixed(1)}℃</title>
                    {p.tier >= 3 && (
                      <circle cx={p.x} cy={p.y} r={(radius(p.tier) * 2.1) / view.k}
                        fill={`var(--t${p.tier})`} opacity={p.tier === 4 ? 0.28 : 0.16} />
                    )}
                    <circle cx={p.x} cy={p.y} r={radius(p.tier) / view.k} fill={`var(--t${p.tier})`}
                      filter={p.tier >= 3 ? 'url(#dotGlow)' : undefined}
                      stroke={hover?.code === p.code ? 'var(--ink)' : 'none'} strokeWidth={1.5 / view.k} />
                    {view.k >= 3.2 && (
                      <text x={p.x} y={p.y - (radius(p.tier) + 4) / view.k} className="dot-label"
                        style={{ fontSize: `${11 / view.k}px` }}>{p.name}</text>
                    )}
                  </g>
                ))}
              </g>
            </g>
          </svg>

          <div className="zoom-ctrl">
            <button onClick={() => zoomAt(W / 2, H / 2, 1.5)} aria-label="拡大">＋</button>
            <button onClick={() => zoomAt(W / 2, H / 2, 1 / 1.5)} aria-label="縮小">−</button>
            <button onClick={reset} aria-label="リセット" className="rst">⟲</button>
          </div>
          <div className="zoom-level">{view.k.toFixed(1)}×</div>
          {hover && (
            <div className="map-tip">
              <strong>{hover.pref} {hover.name}</strong>
              <span className="mt-temp" style={{ color: `var(--t${hover.tier})` }}>{hover.temp.toFixed(1)}℃</span>
              <Badge tier={hover.tier} />
            </div>
          )}
        </div>

        <aside className="map-side">
          <div className="tabs" style={{ marginBottom: '1rem' }}>
            <button className="tab" aria-selected={mode === 'date'} onClick={() => setMode('date')}>特定日</button>
            <button className="tab" aria-selected={mode === 'alltime'} onClick={() => setMode('alltime')}>歴代最高</button>
          </div>

          {mode === 'date' ? (
            <label className="date-jump" style={{ display: 'flex', marginBottom: '1rem' }}>
              日付:
              <input type="date" value={effDate ?? ''} onChange={(e) => setDate(e.target.value || null)} />
            </label>
          ) : (
            <p className="hint" style={{ marginBottom: '1rem' }}>各地点の観測史上最高気温で色分け。</p>
          )}

          <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 1.2rem' }}>
            <div className="stat-box t4"><div className="sv">{counts.kokusho}</div><div className="sl">酷暑日 ≥40</div></div>
            <div className="stat-box t3"><div className="sv">{counts.mousho}</div><div className="sl">猛暑日 ≥35</div></div>
          </div>

          <h4 style={{ margin: '0 0 .6rem' }}>{mode === 'date' ? 'この日の上位' : '歴代最高 上位'}</h4>
          <div className="map-top">
            {top.map((p, i) => (
              <button key={p.code} className="map-top-row" onClick={() => nav(`/station/${p.code}`)}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
                <span className="mrank">{i + 1}</span>
                <span className="mtemp" style={{ color: `var(--t${p.tier})` }}>{p.temp.toFixed(1)}</span>
                <span className="mloc">{p.name}</span>
              </button>
            ))}
          </div>

          <p className="hint" style={{ marginTop: '1rem' }}>
            {plots.length} 地点を表示 ・ 点をクリックで地点ページへ<br />
            地形データ出典: 国土数値情報
          </p>
        </aside>
      </div>
    </div>
  )
}
