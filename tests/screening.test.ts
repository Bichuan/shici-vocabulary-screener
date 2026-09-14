import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { IDBFactory } from 'fake-indexeddb'
import { createIndexedDBStorage } from '../src/domain/screeningStorage.ts'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildSampleQuestions } from '../src/domain/questions.ts'
import { useScreening } from '../src/domain/useScreening.ts'

const bundle = JSON.parse(readFileSync(new URL('../public/data/vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle
const scopes: ReturnType<typeof effectScope>[] = []
async function setup(count = 48) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const questions = ref(buildSampleQuestions(bundle.words, () => 0.999999, false).slice(0, count))
  const active = ref(true)
  const scope = effectScope()
  scopes.push(scope)
  const session = scope.run(() => useScreening(questions, () => bundle.contentVersion, () => active.value, createIndexedDBStorage(new IDBFactory())))!
  await session.ready
  return { ...session, active, scope }
}
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers() })

describe('筛查流程', () => {
  it('答案显示满一秒才切题，期间不接受重复或改选，不重新洗牌', async () => {
    const s = await setup()
    const first = s.question.value!
    const options = s.options.value
    expect(await s.submit(first.id, first.correctOptionId)).toBe(true)
    expect(s.phase.value).toBe('feedback')
    expect(s.options.value).toBe(options)
    expect(await s.submit(first.id, first.options[1]!.id)).toBe(false)
    vi.advanceTimersByTime(999)
    expect(s.question.value?.id).toBe(first.id)
    vi.advanceTimersByTime(1)
    expect(s.question.value?.id).not.toBe(first.id)
    expect(s.phase.value).toBe('ready')
    expect(s.records.value).toHaveLength(1)
    expect(s.wrongWords.value).toHaveLength(0)
    expect(await s.submit(first.id, first.correctOptionId)).toBe(false)
  })
  it('错误立即记录正确核心义和所选释义，保留词库及题目版本，不统计次数', async () => {
    const s = await setup()
    const q = s.question.value!
    const wrong = q.options.find(o => o.id !== q.correctOptionId)!
    expect(await s.submit(q.id, 'invalid')).toBe(false)
    expect(s.records.value).toHaveLength(0)
    await s.submit(q.id, wrong.id)
    expect(s.wrongWords.value[0]).toMatchObject({ wordId: q.wordId, spelling: 'abandon', coreMeaning: '抛弃', selectedMeaning: wrong.text, result: 'wrong', dictionaryVersion: bundle.contentVersion, questionVersion: q.version })
    expect(s.wrongWords.value[0]).not.toHaveProperty('errorCount')
  })
  it('离开页面暂停计时，返回后完整显示一秒，销毁后取消计时', async () => {
    const s = await setup()
    const q = s.question.value!
    await s.submit(q.id, q.correctOptionId)
    vi.advanceTimersByTime(400)
    s.active.value = false
    vi.advanceTimersByTime(10000)
    expect(s.question.value?.id).toBe(q.id)
    s.active.value = true
    vi.advanceTimersByTime(999)
    expect(s.question.value?.id).toBe(q.id)
    s.scope.stop()
    vi.advanceTimersByTime(10000)
    expect(s.question.value?.id).toBe(q.id)
  })
  it('最后一题反馈后结束，不循环答题；累计进度与错词不丢失', async () => {
    const s = await setup(2)
    const first = s.question.value!
    await s.submit(first.id, first.options.find(o => o.id !== first.correctOptionId)!.id)
    vi.advanceTimersByTime(1000)
    const last = s.question.value!
    await s.submit(last.id, last.correctOptionId)
    expect(s.phase.value).toBe('feedback')
    vi.advanceTimersByTime(1000)
    expect(s.phase.value).toBe('completed')
    expect(s.question.value).toBeUndefined()
    expect(s.records.value).toHaveLength(2)
    expect(s.wrongWords.value).toHaveLength(1)
    expect(await s.submit(last.id, last.correctOptionId)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
