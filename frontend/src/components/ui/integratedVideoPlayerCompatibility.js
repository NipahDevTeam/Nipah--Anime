const MEDIA_FILE_EXTENSIONS = ['.mp4', '.webm', '.m4v', '.mov', '.ogv']
const PAGE_FILE_EXTENSIONS = ['.html', '.htm', '.php', '.asp', '.aspx', '.jsp']

function normalizedURLCandidates({ rawStreamURL = '', streamURL = '', proxyURL = '' } = {}) {
  return [rawStreamURL, streamURL, proxyURL]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
}

function stripQueryAndHash(value) {
  const candidate = String(value || '').trim()
  const queryIndex = candidate.indexOf('?')
  const hashIndex = candidate.indexOf('#')
  const cutIndex = [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return cutIndex >= 0 ? candidate.slice(0, cutIndex) : candidate
}

function urlHasExtension(rawURL, extensions) {
  const normalized = stripQueryAndHash(rawURL).toLowerCase()
  return extensions.some((extension) => normalized.endsWith(extension))
}

function isHLSURL(rawURL) {
  return stripQueryAndHash(rawURL).toLowerCase().includes('.m3u8')
}

function isDashURL(rawURL) {
  return stripQueryAndHash(rawURL).toLowerCase().includes('.mpd')
}

function isPageURL(rawURL) {
  return urlHasExtension(rawURL, PAGE_FILE_EXTENSIONS)
}

function isDirectMediaURL(rawURL) {
  return urlHasExtension(rawURL, MEDIA_FILE_EXTENSIONS)
}

function normalizeExplicitKind(streamKind = '') {
  const normalized = String(streamKind || '').trim().toLowerCase()
  switch (normalized) {
    case 'hls':
    case 'dash':
    case 'page':
    case 'file':
    case 'torrent':
      return normalized
    default:
      return ''
  }
}

export function normalizeIntegratedStreamKind(options = {}) {
  const explicitKind = normalizeExplicitKind(options.streamKind)
  const candidates = normalizedURLCandidates(options)

  if (explicitKind === 'torrent') {
    return 'torrent'
  }
  if (explicitKind === 'hls' || candidates.some(isHLSURL)) {
    return 'hls'
  }
  if (explicitKind === 'dash' || candidates.some(isDashURL)) {
    return 'dash'
  }
  if (explicitKind === 'page' || candidates.some(isPageURL)) {
    return 'page'
  }
  if (candidates.some(isDirectMediaURL)) {
    return 'file'
  }
  if (explicitKind === 'file') {
    return 'file'
  }
  return 'unknown'
}

export function getIntegratedPlaybackSupport(options = {}) {
  const normalizedKind = normalizeIntegratedStreamKind(options)

  switch (normalizedKind) {
    case 'hls':
      return { normalizedKind, supported: true, playbackMode: 'hls', reason: '' }
    case 'file':
    case 'torrent':
      return { normalizedKind, supported: true, playbackMode: 'native', reason: '' }
    case 'dash':
      return {
        normalizedKind,
        supported: false,
        playbackMode: 'unsupported',
        reason: 'This stream uses DASH, which the integrated player does not support yet.',
      }
    case 'page':
      return {
        normalizedKind,
        supported: false,
        playbackMode: 'unsupported',
        reason: 'This source returned a web page instead of direct media, so it should open in MPV.',
      }
    default:
      return {
        normalizedKind,
        supported: false,
        playbackMode: 'unsupported',
        reason: 'This stream type is not recognized by the integrated player yet.',
      }
  }
}

export function getIntegratedStreamLabel(options = {}) {
  switch (normalizeIntegratedStreamKind(options)) {
    case 'hls':
      return 'HLS'
    case 'torrent':
      return 'Torrent stream'
    case 'dash':
      return 'DASH'
    case 'page':
      return 'Web page'
    case 'file':
      return 'Direct stream'
    default:
      return 'Unknown stream'
  }
}
