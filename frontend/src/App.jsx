import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'

const Local = lazy(() => import('./pages/Local'))
const AnimeDetail = lazy(() => import('./pages/AnimeDetail'))
const MangaDetail = lazy(() => import('./pages/MangaDetail'))
const MangaSearch = lazy(() => import('./pages/MangaSearch'))
const Search = lazy(() => import('./pages/Search'))
const Settings = lazy(() => import('./pages/Settings'))
const MyLists = lazy(() => import('./pages/MyLists'))

function RouteFallback() {
  return (
    <div className="empty-state">
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
      </div>
    </div>
  )
}

function StartupBeacon() {
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const sinceBoot = typeof window.__nipahBootAt === 'number'
        ? Math.round(performance.now() - window.__nipahBootAt)
        : null
      console.info('[startup] app shell painted', {
        sinceBootMs: sinceBoot,
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return null
}

export default function App() {
  return (
    <Layout>
      <StartupBeacon />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/local" element={<Local />} />
          <Route path="/anime" element={<Navigate to="/local" replace />} />
          <Route path="/anime/:id" element={<AnimeDetail />} />
          <Route path="/manga" element={<Navigate to="/local?tab=manga" replace />} />
          <Route path="/manga/:id" element={<MangaDetail />} />
          <Route path="/mis-listas" element={<MyLists />} />
          <Route path="/descubrir" element={<Navigate to="/home" replace />} />
          <Route path="/search" element={<Search />} />
          <Route path="/manga-online" element={<MangaSearch />} />
          <Route path="/descargas" element={<Navigate to="/local?tab=downloads" replace />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
