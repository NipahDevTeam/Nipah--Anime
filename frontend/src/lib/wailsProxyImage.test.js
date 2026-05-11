import assert from 'node:assert/strict'

import { proxyImage } from './wails.js'

{
  const localProxyURL = 'http://127.0.0.1:43212/proxy/image?url=https%3A%2F%2Fcdn.example%2Fpage-1.webp&source=m440-es&referer=https%3A%2F%2Fm440.in%2Fmanga%2Fseries%2F1-a%2F1'

  assert.equal(
    proxyImage(localProxyURL, { sourceID: 'm440-es' }),
    localProxyURL,
    'proxyImage should leave already-local image proxy URLs untouched',
  )
}

{
  const proxied = proxyImage('https://cdn.example/page-1.webp', { sourceID: 'm440-es' })
  const parsed = new URL(proxied)

  assert.equal(parsed.origin, 'http://127.0.0.1:43212', 'proxyImage should route source-backed remote images through the local proxy origin')
  assert.equal(parsed.pathname, '/proxy/image', 'proxyImage should keep routing source-backed remote images through /proxy/image')
  assert.equal(parsed.searchParams.get('url'), 'https://cdn.example/page-1.webp', 'proxyImage should preserve the original remote image URL')
  assert.equal(parsed.searchParams.get('source'), 'm440-es', 'proxyImage should preserve the source id for source-backed image requests')
}

console.log('wails proxyImage tests passed')
