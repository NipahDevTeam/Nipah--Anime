import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { bootReactScan } from './lib/reactScan'
import './index.css'
import './revamp.css'

window.__nipahBootAt = performance.now()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
})

void bootReactScan()

requestAnimationFrame(() => {
  console.info('[startup] react boot scheduled', {
    sinceBootMs: Math.round(performance.now() - window.__nipahBootAt),
  })
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <I18nProvider>
          <App />
        </I18nProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
