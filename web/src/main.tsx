import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './styles.css'
import Shell from './Shell'
import Home from './pages/Home'
import Rankings from './pages/Rankings'
import DatePage from './pages/DatePage'
import StationPage from './pages/StationPage'
import StationsList from './pages/StationsList'
import MapPage from './pages/MapPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="rankings" element={<Rankings />} />
          <Route path="stations" element={<StationsList />} />
          <Route path="station/:code" element={<StationPage />} />
          <Route path="date/:date" element={<DatePage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)
