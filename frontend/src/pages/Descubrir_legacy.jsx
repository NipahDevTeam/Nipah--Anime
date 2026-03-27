import { DiscoverFeed } from './Descubrir'

// Explicit backup of the former standalone discover page. Home keeps using the
// shared DiscoverFeed directly, while the route itself now redirects to /home.
export default function DescubrirLegacy() {
  return <DiscoverFeed />
}
