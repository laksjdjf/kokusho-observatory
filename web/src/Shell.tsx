import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

function useHeatAmbience() {
  useEffect(() => {
    const root = document.documentElement
    let ticking = false
    const update = () => {
      const maxScroll = Math.max(document.body.scrollHeight - window.innerHeight, 1)
      root.style.setProperty('--heat-scroll', Math.min(window.scrollY / (maxScroll * 0.65), 1).toFixed(3))
      ticking = false
    }
    const onScroll = () => { if (!ticking) { requestAnimationFrame(update); ticking = true } }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    const grain = document.querySelector<HTMLDivElement>('.grain')
    if (grain) {
      const c = document.createElement('canvas'); c.width = c.height = 128
      const ctx = c.getContext('2d')
      if (ctx) {
        const img = ctx.createImageData(128, 128)
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v
          img.data[i + 3] = Math.random() * 38
        }
        ctx.putImageData(img, 0, 0)
        grain.style.backgroundImage = `url(${c.toDataURL()})`
      }
    }
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}

const NAV = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/rankings', label: 'ランキング' },
  { to: '/stations', label: '地点一覧' },
  { to: '/map', label: '地図' },
]

export default function Shell() {
  useHeatAmbience()
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (
    <>
      <div className="heatfield" aria-hidden>
        <div className="blob blob1" /><div className="blob blob2" /><div className="blob blob3" />
        <div className="heatfield-tint" />
      </div>
      <div className="grain" aria-hidden />

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <defs>
          <filter id="heatHaze" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" numOctaves={2} seed={7} result="noise">
              <animate attributeName="baseFrequency" values="0.008 0.03;0.018 0.045;0.008 0.03" dur="7s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={7} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="heatHazeStrong" x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" numOctaves={2} seed={11} result="noise2">
              <animate attributeName="baseFrequency" values="0.01 0.04;0.025 0.06;0.01 0.04" dur="4.5s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise2" scale={14} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="brand-mini">
              最高気温マニア <span>酷暑オブザーバトリー</span>
            </NavLink>
            <nav className="mainnav">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>

        <footer className="site-footer">
          <div className="page-wrap">
            <span>出典：気象庁ホームページ（歴代全国ランキング・過去の気象データ）を加工して作成</span>
            <span>公共データ利用規約（第1.0版）準拠 ・ プロトタイプ</span>
          </div>
        </footer>
      </div>
    </>
  )
}
