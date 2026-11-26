import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import worker from '../usage-stats/worker.mjs'

const SITE_ORIGIN = 'https://bichuan.github.io'
const url = 'https://usage.example.test/first-use'

describe('线上使用量接收接口', () => {
  const request = (id, origin = SITE_ORIGIN) => new Request(url, {
    method: 'POST',
    headers: { origin },
    body: id,
  })

  it('同一个随机编号重传只计入一次', async () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(readFileSync(new URL('../usage-stats/schema.sql', import.meta.url), 'utf8'))
      const USAGE = { prepare: sql => ({ bind: id => ({ run: () => db.prepare(sql).run(id) }) }) }
      const env = { SITE_ORIGIN, USAGE }
      const id = crypto.randomUUID()
      const replies = await Promise.all([id, id, crypto.randomUUID()].map(item => worker.fetch(request(item), env)))
      expect(replies.map(response => response.status)).toEqual([204, 204, 204])
      expect(replies[0].headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN)
      expect(db.prepare('SELECT COUNT(*) AS total FROM first_use').get().total).toBe(2)
    } finally {
      db.close()
    }
  })

  it('拒绝非正式网页的请求和带额外数据的内容', async () => {
    const prepare = vi.fn()
    const env = { SITE_ORIGIN, USAGE: { prepare } }
    expect((await worker.fetch(request(crypto.randomUUID(), 'https://example.org'), env)).status).toBe(403)
    expect((await worker.fetch(request('{"word":"watch"}'), env)).status).toBe(400)
    expect(prepare).not.toHaveBeenCalled()
  })
})
