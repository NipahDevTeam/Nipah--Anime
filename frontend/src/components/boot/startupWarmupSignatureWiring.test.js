import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'startupWarmup.js'), 'utf8')

assert.ok(
  !source.includes("await wails.discoverManga('', 0, 'TRENDING_DESC', '', '', 1)"),
  'Startup warmup should not block on the default manga catalog once Manga Online is allowed to trail after Home reveal',
)

assert.ok(
  source.includes('wails.getAniListMangaByID') && source.includes("background: ["),
  'Startup warmup should move manga AniList detail prewarm behind reveal instead of blocking startup',
)

assert.ok(
  !source.includes("await wails.discoverAnime('', '', 0, 'TRENDING_DESC', '', '', 1)"),
  'Startup warmup should not block on the default anime catalog once Anime Online is allowed to trail after Home reveal',
)

assert.ok(
  source.includes('wails.getAniListAnimeByID') && source.includes("background: ["),
  'Startup warmup should move anime AniList detail prewarm behind reveal instead of blocking startup',
)

assert.ok(
  source.includes('wails.getAniListAnimeCatalogHome(season, year)'),
  'Startup warmup should now pull the AniList anime home payload into the blocking first-paint contract',
)

assert.ok(
  source.includes('wails.getAniListMangaCatalogHome(lang)'),
  'Startup warmup should also block on the base AniList manga home payload so the Manga side is not hollow by default',
)

assert.ok(
  source.includes("key: 'anime-home-catalog'"),
  'Startup warmup should expose a dedicated blocking anime home task for the new reveal contract',
)

assert.ok(
  source.includes("queryKey: ['gui2-home-anilist', lang, season, year]"),
  'Startup warmup should seed the exact anime Home query key consumed by the GUI2 Home route',
)

assert.ok(
  source.includes("key: 'manga-home-catalog'"),
  'Startup warmup should expose a dedicated blocking manga home task for the new reveal contract',
)

assert.ok(
  source.includes("queryKey: ['gui2-home-manga-catalog', lang]"),
  'Startup warmup should seed the exact manga Home query key consumed by the GUI2 Home route',
)

assert.ok(
  source.includes("queryKey: ['anime-catalog', lang, 'TRENDING_DESC', '', '', 0, 1, '', '']") && source.includes("background: ["),
  'Startup warmup should keep the default Anime Online catalog warmup, but only behind reveal',
)

assert.ok(
  source.includes("queryKey: ['manga-catalog', lang, 'TRENDING_DESC', '', 0, 1, '', '']") && source.includes("background: ["),
  'Startup warmup should keep the default Manga Online catalog warmup, but only behind reveal',
)

assert.ok(
  source.includes("background: [") && source.includes("queryKey: ['gui2-my-lists-anime-entries']") && source.includes('wails.getAnimeListAll()'),
  'Startup warmup should defer Anime My Lists hydration to the background queue instead of blocking first reveal',
)

assert.ok(
  source.includes("background: [") && source.includes("queryKey: ['gui2-my-lists-manga-entries']") && source.includes('wails.getMangaListAll()'),
  'Startup warmup should defer Manga My Lists hydration to the background queue instead of blocking first reveal',
)

assert.ok(
  source.includes('BOOT_STAGE_PREPARING_HOME'),
  'startup warmup should emit a preparing-home stage before the blocking Home contract resolves',
)

assert.ok(
  source.includes('onStageChange?.(BOOT_STAGE_FINAL_REVEAL)'),
  'startup warmup should expose a final reveal stage once the startup snapshot is ready',
)

assert.ok(
  source.includes('ready: startupReady'),
  'startup warmup should expose a single overall startup-ready flag once the reduced Home-first contract is satisfied',
)

assert.ok(
  source.includes("key: 'remote-sync-status'") && source.includes('background: ['),
  'Startup warmup should move remote sync status behind reveal with the rest of the non-Home contract',
)

console.log('startup warmup signature wiring tests passed')
