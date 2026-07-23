import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Tier } from './types'
import { TIER_LABEL } from './types'

const BASE = import.meta.env.BASE_URL

export function useJson<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true); setData(null); setError(null)
    fetch(`${BASE}${path}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch((e) => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [path])
  return { data, error, loading }
}

export function tierFor(t: number): Tier {
  return (t >= 40 ? 4 : t >= 35 ? 3 : t >= 30 ? 2 : t >= 25 ? 1 : 0) as Tier
}

export function Badge({ tier }: { tier: Tier }) {
  if (tier === 0) return null
  return <span className={`badge tier-${tier}`}>{TIER_LABEL[tier]}</span>
}

/** tier に応じた行スタイル（--tier-color / --tier-bg） */
export function tierRowStyle(tier: Tier): CSSProperties {
  return { ['--tier-color' as string]: `var(--t${tier})`, ['--tier-bg' as string]: `var(--t${tier}-bg)` }
}

export function StationLink({ code, children }: { code?: string; children: ReactNode }) {
  if (!code) return <>{children}</>
  return <Link className="st-link" to={`/station/${code}`}>{children}</Link>
}

export function DateLink({ date, children }: { date?: string | null; children?: ReactNode }) {
  if (!date) return <>—</>
  return <Link className="st-link" to={`/date/${date}`}>{children ?? date}</Link>
}
