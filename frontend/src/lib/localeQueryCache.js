export const LOCALE_QUERY_KEY_PREFIXES = new Set([
  'anime-catalog',
  'manga-catalog',
  'gui2-home-trending',
  'gui2-home-featured-rows',
  'gui2-home-discovery-rows',
  'home-catalog-anime-hero',
  'home-catalog-anime-primary',
  'home-catalog-manga-primary',
  'home-catalog-anime-genres',
  'home-manga-recommendations',
])

export function mirrorLocaleQueryCache(queryClient, fromLang, toLang) {
  if (!queryClient || !fromLang || !toLang || fromLang === toLang) return 0

  const queryCache = queryClient.getQueryCache?.()
  const queries = queryCache?.findAll?.() ?? []
  let mirroredCount = 0

  queries.forEach((query) => {
    const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : null
    if (!queryKey || queryKey.length < 2) return

    const [prefix, queryLang] = queryKey
    if (!LOCALE_QUERY_KEY_PREFIXES.has(prefix) || queryLang !== fromLang) return

    const nextKey = [prefix, toLang, ...queryKey.slice(2)]
    if (queryClient.getQueryData?.(nextKey) !== undefined) return

    const data = query?.state?.data
    if (typeof data === 'undefined') return

    queryClient.setQueryData?.(nextKey, data)
    mirroredCount += 1
  })

  return mirroredCount
}
