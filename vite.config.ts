import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { generateServiceWorker } from './scripts/generate-service-worker.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

function offlineServiceWorker(): Plugin {
  let currentBundleFiles: string[] = []
  return {
    name: 'shici-offline-service-worker',
    apply: 'build',
    writeBundle(_options, bundle) {
      currentBundleFiles = Object.keys(bundle)
    },
    closeBundle() {
      generateServiceWorker(resolve(root, 'dist'), currentBundleFiles)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), offlineServiceWorker()],
  build: { emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
