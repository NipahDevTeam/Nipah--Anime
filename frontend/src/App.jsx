import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import AnimeLibrary from './pages/AnimeLibrary'
import AnimeDetail from './pages/AnimeDetail'
import MangaLibrary from './pages/MangaLibrary'
import MangaDetail from './pages/MangaDetail'
import MangaSearch from './pages/MangaSearch'
import Search from './pages/Search'
import Settings from './pages/Settings'
import Descubrir from './pages/Descubrir'
import MyLists from './pages/MyLists'
import Downloads from './pages/Downloads'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/anime" element={<AnimeLibrary />} />
        <Route path="/anime/:id" element={<AnimeDetail />} />
        <Route path="/manga" element={<MangaLibrary />} />
        <Route path="/manga/:id" element={<MangaDetail />} />
        <Route path="/mis-listas" element={<MyLists />} />
        <Route path="/descubrir" element={<Descubrir />} />
        <Route path="/search" element={<Search />} />
        <Route path="/manga-online" element={<MangaSearch />} />
        <Route path="/descargas" element={<Downloads />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
