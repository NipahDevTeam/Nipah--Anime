import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

const shouldVisualize = process.env.VITE_VISUALIZE === '1'

export default defineConfig({
  plugins: [
    react(),
    ...(shouldVisualize ? [visualizer({
      filename: 'dist/bundle-stats.html',
      gzipSize: true,
      brotliSize: true,
      open: false,
    })] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return null
          if (id.includes('react') || id.includes('react-router-dom')) return 'react-vendor'
          if (id.includes('@tanstack/react-query')) return 'query-vendor'
          if (id.includes('hls.js') || id.includes('react-virtuoso') || id.includes('blurhash')) return 'media-vendor'
          return 'vendor'
        },
      },
    },
  },
  // Wails injects window.go bindings — tell Vite not to complain
  define: {
    'process.env': {},
  },
})
