import { describe, expect, it } from 'vitest'
import { createServiceWorker } from '../scripts/generate-service-worker.ts'

describe('PWA 离线版本', () => {
  const files = [
    { path: 'index.html', content: new TextEncoder().encode('<main>拾词</main>') },
    { path: 'assets/app-123.js', content: new TextEncoder().encode('console.log("app")') },
    { path: 'data/vocabulary.json', content: new TextEncoder().encode('{"words":[]}') },
  ]

  it('完整预缓存页面、程序和词库，缓存完成后启用新版', () => {
    const generated = createServiceWorker(files)
    expect(generated.precacheUrls).toEqual([
      './assets/app-123.js',
      './data/vocabulary.json',
      './index.html',
    ])
    expect(generated.source).toContain('cache.addAll(PRECACHE_URLS)')
    expect(generated.source).toContain('.then(() => self.skipWaiting())')
    expect(generated.source).toContain("request.mode === 'navigate'")
    expect(generated.source).toContain("fetch(request, { cache: 'no-store' })")
    expect(generated.source).toContain("name.startsWith(CACHE_PREFIX)")
    expect(generated.source).toContain("event.data?.type === 'ACTIVATE_UPDATE'")
    expect(generated.source).not.toContain('clients.claim')
  })

  it('任一文件变化都会生成新缓存，失败的新版不会删除旧缓存', () => {
    const current = createServiceWorker(files)
    const changed = createServiceWorker(files.map(file => file.path === 'data/vocabulary.json'
      ? { ...file, content: new TextEncoder().encode('{"words":[1]}') }
      : file))
    expect(changed.cacheName).not.toBe(current.cacheName)

    const installStart = current.source.indexOf("self.addEventListener('install'")
    expect(installStart).toBeGreaterThanOrEqual(0)
    expect(current.source).not.toContain('caches.delete')
  })
})
