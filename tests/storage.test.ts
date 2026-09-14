import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildSampleQuestions } from '../src/domain/questions.ts'
import { createIndexedDBStorage, validateSnapshot, type ScreeningSnapshot, type ScreeningStorage } from '../src/domain/screeningStorage.ts'
import { useScreening } from '../src/domain/useScreening.ts'

const bundle = JSON.parse(readFileSync(new URL('../public/data/vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle
const scopes: ReturnType<typeof effectScope>[] = []
function start(storage: ScreeningStorage, count = 48, version = bundle.contentVersion) {
  const scope = effectScope()
  scopes.push(scope)
  const session = scope.run(() => useScreening(ref(buildSampleQuestions(bundle.words, () => 0.999999, false).slice(0, count)), () => version, () => true, storage))!
  return { ...session, scope }
}
afterEach(() => { scopes.splice(0).forEach(s => s.stop()) })

describe('IndexedDB 本地存档', () => {
  it('反馈期间关闭再打开，从下一题继续并保留错词、进度和任务标识', async () => {
    const factory = new IDBFactory()
    const storage = createIndexedDBStorage(factory)
    const first = start(storage)
    await first.ready
    const q = first.question.value!
    await first.submit(q.id, q.options.find(o => o.id !== q.correctOptionId)!.id)
    expect(first.phase.value).toBe('feedback')
    const record = JSON.parse(JSON.stringify(first.records.value[0]))
    first.scope.stop()
    const reopened = start(createIndexedDBStorage(factory))
    await reopened.ready
    expect(reopened.phase.value).toBe('ready')
    expect(reopened.question.value?.spelling).toBe('absorb')
    expect(reopened.records.value).toEqual([record])
    expect(reopened.wrongWords.value[0]?.coreMeaning).toBe('抛弃')
  })

  it('把旧版 48 题记录迁移为原表释义，并能从下一题继续保存', async () => {
    const factory = new IDBFactory()
    const disk = createIndexedDBStorage(factory)
    const current = buildSampleQuestions(bundle.words, () => 0.999999, false).slice(0, 48)
    const taskId = 'legacy-task'
    const legacy: ScreeningSnapshot = {
      schemaVersion: 1,
      dictionaryVersion: bundle.contentVersion,
      questionSignature: '[["day2-core-v1:legacy","day2-core-v1"]]',
      taskId,
      revision: 1,
      records: [{
        id: 'legacy-answer', taskId, wordId: current[0]!.wordId,
        dictionaryVersion: bundle.contentVersion, questionVersion: 'day2-core-v1',
        selectedOptionId: 'g0-o0', result: 'correct', answeredAt: '2026-09-13T00:00:00.000Z',
        spelling: 'abandon', coreMeaning: '放弃', selectedMeaning: '放弃',
      }],
    }
    await disk.save(legacy, 0)
    const session = start(createIndexedDBStorage(factory))
    await session.ready
    expect(session.records.value[0]).toMatchObject({ spelling: 'abandon', coreMeaning: '抛弃', selectedMeaning: '抛弃', result: 'correct' })
    expect(session.question.value?.spelling).toBe('absorb')
    await session.submit(session.question.value!.id, session.question.value!.correctOptionId)
    const saved = await disk.load() as ScreeningSnapshot
    expect(saved.revision).toBe(2)
    expect(saved.questionSignature).toMatch(/^questions-v3:48:/)
  })

  it('题序随机化后迁移现有全量存档，并按单词标识跳过已答词', async () => {
    const factory = new IDBFactory()
    const disk = createIndexedDBStorage(factory)
    const fixed = buildSampleQuestions(bundle.words, () => 0.999999, false)
    const answered = fixed[12]!
    const taskId = 'source-order-task'
    await disk.save({
      schemaVersion: 1, dictionaryVersion: bundle.contentVersion,
      questionSignature: `questions-v2:${fixed.length}:previous-order`,
      taskId, revision: 1,
      records: [{
        id: 'source-order-answer', taskId, wordId: answered.wordId,
        dictionaryVersion: bundle.contentVersion, questionVersion: answered.version,
        selectedOptionId: answered.correctOptionId, result: 'correct', answeredAt: '2026-09-14T00:00:00.000Z',
        spelling: answered.spelling, coreMeaning: answered.coreMeaning, selectedMeaning: answered.coreMeaning,
      }],
    }, 0)
    const randomized = buildSampleQuestions(bundle.words, () => 0, true)
    const scope = effectScope()
    scopes.push(scope)
    const session = scope.run(() => useScreening(ref(randomized), () => bundle.contentVersion, () => true, createIndexedDBStorage(factory)))!
    await session.ready
    expect(session.records.value.map(record => record.wordId)).toEqual([answered.wordId])
    expect(session.question.value?.wordId).not.toBe(answered.wordId)
    await session.submit(session.question.value!.id, session.question.value!.correctOptionId)
    expect((await disk.load() as ScreeningSnapshot).questionSignature).toMatch(/^questions-v3:5220:/)
  })

  it('保存失败保留选择，停止切题；重试成功只写入一次', async () => {
    const disk = createIndexedDBStorage(new IDBFactory())
    const save = vi.fn(disk.save).mockRejectedValueOnce(new Error('QuotaExceededError'))
    const s = start({ load: disk.load, save })
    await s.ready
    const q = buildSampleQuestions(bundle.words, () => 0.999999, false)[0]!
    expect(await s.submit(q.id, q.correctOptionId)).toBe(false)
    expect(s.phase.value).toBe('error')
    expect(s.pending.value?.wordId).toBe(q.wordId)
    expect(s.records.value).toHaveLength(0)
    expect(await disk.load()).toBeUndefined()
    expect(await s.savePending()).toBe(true)
    expect(s.pending.value).toBeNull()
    expect((await disk.load() as ScreeningSnapshot).records).toHaveLength(1)
  })

  it('存储尚未提交时锁定按钮，不增加已保存进度或启动反馈', async () => {
    const disk = createIndexedDBStorage(new IDBFactory())
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const s = start({ load: disk.load, save: async (...args) => { await gate; await disk.save(...args) } })
    await s.ready
    const q = s.question.value!
    const saving = s.submit(q.id, q.correctOptionId)
    expect(s.phase.value).toBe('saving')
    expect(s.records.value).toHaveLength(0)
    expect(await s.submit(q.id, q.options[1]!.id)).toBe(false)
    release()
    await saving
    expect(s.phase.value).toBe('feedback')
  })

  it('两个页面同时提交，只有一个事务成功，另一个不能覆盖存档', async () => {
    const factory = new IDBFactory()
    const disk = createIndexedDBStorage(factory)
    const a = start(disk)
    const b = start(createIndexedDBStorage(factory))
    await Promise.all([a.ready, b.ready])
    const q = a.question.value!
    const results = await Promise.all([a.submit(q.id, q.correctOptionId), b.submit(q.id, q.options[1]!.id)])
    expect(results.filter(Boolean)).toHaveLength(1)
    const loser = results[0] ? b : a
    expect(loser.conflict.value).toBe(true)
    expect(loser.storageError.value).toContain('另一个页面')
    expect((await disk.load() as ScreeningSnapshot).records).toHaveLength(1)
  })

  it('最后一题保存后关闭，再打开直接恢复完成状态', async () => {
    const disk = createIndexedDBStorage(new IDBFactory())
    const a = start(disk, 1)
    await a.ready
    const q = a.question.value!
    await a.submit(q.id, q.correctOptionId)
    a.scope.stop()
    const b = start(disk, 1)
    await b.ready
    expect(b.phase.value).toBe('completed')
    expect(b.records.value).toHaveLength(1)
    expect(b.question.value).toBeUndefined()
  })

  it('拒绝不兼容版本和损坏存档，保留旧数据而非静默清空', async () => {
    const disk = createIndexedDBStorage(new IDBFactory())
    const a = start(disk)
    await a.ready
    const q = a.question.value!
    await a.submit(q.id, q.correctOptionId)
    a.scope.stop()
    const original = await disk.load() as ScreeningSnapshot
    const b = start(disk, 48, 'new-dictionary')
    await b.ready
    expect(b.phase.value).toBe('error')
    expect(b.storageError.value).toContain('版本')
    expect(await disk.load()).toEqual(original)
    const corrupted = structuredClone(original)
    corrupted.records[0]!.coreMeaning = '错误的释义'
    expect(() => validateSnapshot(corrupted, bundle.contentVersion, buildSampleQuestions(bundle.words, () => 0.999999, false))).toThrow('不一致')
    expect(() => validateSnapshot({ ...original, schemaVersion: 999 }, bundle.contentVersion, buildSampleQuestions(bundle.words, () => 0.999999, false))).toThrow('格式')
  })

  it('读取失败时不允许答题，重试可以恢复已有进度', async () => {
    const disk = createIndexedDBStorage(new IDBFactory())
    const load = vi.fn(disk.load).mockRejectedValueOnce(new Error('读取失败'))
    const s = start({ load, save: disk.save })
    await s.ready
    expect(s.phase.value).toBe('error')
    const q = buildSampleQuestions(bundle.words, () => 0.999999, false)[0]!
    expect(await s.submit(q.id, q.correctOptionId)).toBe(false)
    await s.restore()
    expect(s.phase.value).toBe('ready')
  })
})
