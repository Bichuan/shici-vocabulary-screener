import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createUsageReporter } from '../src/domain/usageStats.ts'

const endpoint = 'https://usage.example.test/first-use'
const success = () => new Response(null, { status: 204 })

describe('首次使用统计', () => {
  it('只在完成作答后发送随机编号，刷新和重复作答不再发送', async () => {
    const factory = new IDBFactory()
    const send = vi.fn<typeof fetch>().mockResolvedValue(success())
    const reporter = createUsageReporter(endpoint, factory, send, () => true)
    await reporter.retry()
    expect(send).not.toHaveBeenCalled()
    await reporter.recordFirstAnswer()
    await reporter.recordFirstAnswer()
    await createUsageReporter(endpoint, factory, send, () => true).recordFirstAnswer()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      body: expect.stringMatching(/^[0-9a-f-]{36}$/),
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }))
  })

  it('离线第一次作答记为待发送，重开联网后补记', async () => {
    const factory = new IDBFactory()
    const send = vi.fn<typeof fetch>().mockResolvedValue(success())
    await createUsageReporter(endpoint, factory, send, () => false).recordFirstAnswer()
    expect(send).not.toHaveBeenCalled()
    const reopened = createUsageReporter(endpoint, factory, send, () => true)
    await reopened.retry()
    await reopened.retry()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('网络失败用同一个编号重试，多个使用入口共享存储时沿用该编号', async () => {
    const factory = new IDBFactory()
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(success())
    const reporter = createUsageReporter(endpoint, factory, send, () => true)
    await reporter.recordFirstAnswer()
    const reopened = createUsageReporter(endpoint, factory, send, () => true)
    await reopened.retry()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]![1]?.body).toBe(send.mock.calls[1]![1]?.body)
  })

  it('同时作答的两个标签页从同一事务读取同一个编号', async () => {
    const factory = new IDBFactory()
    const send = vi.fn<typeof fetch>().mockResolvedValue(success())
    const tabs = [1, 2].map(() => createUsageReporter(endpoint, factory, send, () => true))
    await Promise.all(tabs.map(tab => tab.recordFirstAnswer()))
    expect(send).toHaveBeenCalled()
    expect(new Set(send.mock.calls.map(([, options]) => options?.body)).size).toBe(1)
  })
})
