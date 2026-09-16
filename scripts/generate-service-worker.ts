import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const CACHE_PREFIX = 'shici-offline-'
const WORKER_FILE = 'service-worker.js'

function listFiles(directory: string, root = directory): string[] {
  return readdirSync(directory).flatMap(name => {
    const fullPath = join(directory, name)
    return statSync(fullPath).isDirectory() ? listFiles(fullPath, root) : [relative(root, fullPath).split(sep).join('/')]
  }).filter(path => path !== WORKER_FILE).sort()
}

export function createServiceWorker(files: Array<{ path: string; content: Uint8Array }>) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
  }
  const version = hash.digest('hex').slice(0, 16)
  const cacheName = `${CACHE_PREFIX}${version}`
  const precacheUrls = files.map(file => `./${file.path}`).sort()
  const source = `/* Generated at build time. Do not edit directly. */
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};
const OFFLINE_ENTRY = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
// Keep older version caches: other open pages can still need their own assets.

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      const entry = await cache.match(OFFLINE_ENTRY);
      return entry || fetch(request);
    }
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    return cached || fetch(request);
  })());
});
`
  return { version, cacheName, precacheUrls, source }
}

export function generateServiceWorker(outputDirectory: string, currentBundleFiles: readonly string[] = []) {
  const currentBundle = new Set(currentBundleFiles.map(path => path.split(sep).join('/')))
  const paths = listFiles(outputDirectory).filter(path => !path.startsWith('assets/') || currentBundle.has(path))
  const generated = createServiceWorker(paths.map(path => ({ path, content: readFileSync(join(outputDirectory, path)) })))
  writeFileSync(join(outputDirectory, WORKER_FILE), generated.source, 'utf8')
  return generated
}
