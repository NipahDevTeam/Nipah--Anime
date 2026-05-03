import assert from 'node:assert/strict'
import {
  getGui2Navigation,
  getGui2RouteMeta,
  isGui2PreviewPath,
  normalizeGui2Path,
  withGui2Prefix,
} from './routeRegistry.js'

assert.equal(normalizeGui2Path('/'), '/home')
assert.equal(normalizeGui2Path('/__rebuild'), '/home')
assert.equal(normalizeGui2Path('/__rebuild/search'), '/anime-online')
assert.equal(normalizeGui2Path('/mis-listas'), '/my-lists')
assert.equal(normalizeGui2Path('/descargas'), '/local')
assert.equal(normalizeGui2Path('/downloads'), '/local')
assert.equal(normalizeGui2Path('/anime/42'), '/anime/42')
assert.equal(normalizeGui2Path('/manga/99'), '/manga/99')

assert.equal(isGui2PreviewPath('/__rebuild/settings'), true)
assert.equal(isGui2PreviewPath('/settings'), false)
assert.equal(withGui2Prefix('/home', true), '/__rebuild/home')
assert.equal(withGui2Prefix('/home', false), '/home')

const nav = getGui2Navigation(true)
assert.equal(nav.primary[0].to, '/__rebuild/home')
assert.equal(nav.secondary[0].to, '/__rebuild/settings')
assert.equal(nav.secondary.length, 1)
assert.equal(nav.primary.some((item) => item.key === 'history'), false)
assert.equal(nav.primary.some((item) => item.key === 'downloads'), false)
assert.equal(nav.secondary.some((item) => item.key === 'sources'), false)
assert.equal(nav.secondary.some((item) => item.key === 'tools'), false)
assert.equal(nav.secondary.some((item) => item.key === 'help'), false)

const navEs = getGui2Navigation(false, 'es')
assert.equal(navEs.primary[0].label, 'Inicio')
assert.equal(navEs.primary[1].label, 'Anime Online')
assert.equal(navEs.secondary[0].label, 'Ajustes')

const homeMeta = getGui2RouteMeta('/home')
assert.equal(homeMeta.key, 'home')
assert.equal(homeMeta.title, 'Home')

const homeMetaEs = getGui2RouteMeta('/home', 'es')
assert.equal(homeMetaEs.title, 'Inicio')

const detailMeta = getGui2RouteMeta('/__rebuild/anime/44')
assert.equal(detailMeta.key, 'anime-detail')
assert.equal(detailMeta.canonicalPath, '/anime/44')

console.log('gui-v2 route registry tests passed')
