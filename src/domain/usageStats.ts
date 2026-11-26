interface UsageState {
  id: string
  sent: boolean
}

// Keep statistics in a separate database so that reset, restore and export
// continue to operate on learning records only.
function updateFirstUse(
  factory: IDBFactory,
  update: (current?: UsageState) => UsageState | undefined,
): Promise<UsageState | undefined> {
  return new Promise((resolve, reject) => {
    const open = factory.open('shici-usage', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('usage')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('usage', 'readwrite')
      const store = tx.objectStore('usage')
      const read = store.get('first-use')
      let next: UsageState | undefined
      read.onsuccess = () => {
        const current = read.result as UsageState | undefined
        next = update(current)
        if (next && next !== current) store.put(next, 'first-use')
      }
      tx.oncomplete = () => { db.close(); resolve(next) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

export function createUsageReporter(
  endpoint: string,
  factory: IDBFactory,
  send: typeof fetch = fetch,
  online = () => navigator.onLine,
) {
  let queue = Promise.resolve()
  let recorded = false
  let sent = false

  function report(firstAnswer: boolean) {
    if (sent || (firstAnswer && recorded)) return queue
    if (firstAnswer) recorded = true
    queue = queue.then(async () => {
      if (sent) return
      const state = await updateFirstUse(factory, current =>
        current ?? (firstAnswer ? { id: crypto.randomUUID(), sent: false } : undefined),
      )
      if (state?.sent) { sent = true; return }
      if (!state || !online()) return
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), 6000)
      const response = await send(endpoint, {
        method: 'POST',
        body: state.id,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        signal: timeout.signal,
      }).catch(() => null).finally(() => clearTimeout(timer))
      if (response?.status !== 204) return
      await updateFirstUse(factory, current => current?.id === state.id ? { ...current, sent: true } : current)
      sent = true
    }).catch(() => { if (firstAnswer) recorded = false })
    return queue
  }

  return {
    recordFirstAnswer: () => report(true),
    retry: () => report(false),
  }
}

const endpoint = (import.meta.env.VITE_USAGE_ENDPOINT as string | undefined)?.trim()
const reporter = endpoint?.startsWith('https://') && typeof indexedDB !== 'undefined' &&
  typeof location !== 'undefined' && location.protocol === 'https:'
  ? createUsageReporter(endpoint, indexedDB)
  : null

export const usageReportingEnabled = reporter !== null
export const reportFirstUse = () => reporter?.recordFirstAnswer()
export const retryUsageReport = () => reporter?.retry()
