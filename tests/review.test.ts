import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildSampleQuestions } from '../src/domain/questions.ts'
import { createIndexedDBStorage, questionSignature, type ScreeningSnapshot } from '../src/domain/screeningStorage.ts'
import { activeRound, beginReview, createReviewStorage, loadValidatedReviewHistory, reviewSessionStorage, reviewWords, roundQuestions, validateReviewHistory, type ReviewHistory } from '../src/domain/review.ts'
import { useScreening } from '../src/domain/useScreening.ts'

const bundle = JSON.parse(readFileSync(new URL('../public/data/vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle
const questions = buildSampleQuestions(bundle.words, () => 0.999999, false).slice(0, 3)
function initialSnapshot(): ScreeningSnapshot {
  const taskId = crypto.randomUUID()
  return { schemaVersion: 1, taskId, revision: 3, dictionaryVersion: bundle.contentVersion, questionSignature: questionSignature(questions), records: questions.map((q, index) => {
    const option = index === 2 ? q.options.find(o => o.id === q.correctOptionId)! : q.options.find(o => o.id !== q.correctOptionId)!
    return { id: crypto.randomUUID(), taskId, wordId: q.wordId, dictionaryVersion: bundle.contentVersion, questionVersion: q.version, selectedOptionId: option.id, result: index === 2 ? 'correct' : 'wrong', answeredAt: new Date().toISOString(), spelling: q.spelling, coreMeaning: q.coreMeaning, selectedMeaning: option.text }
  }) }
}
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()) })

describe('错词复筛', () => {
  it('从旧版初筛存档创建复筛，初筛本身不修改，答对移出待复筛但保留历史', async () => {
    const factory = new IDBFactory()
    const initial = initialSnapshot()
    const initialDisk = createIndexedDBStorage(factory)
    await initialDisk.save(initial, 0)
    const disk = createReviewStorage(factory)
    let history = await beginReview(initial, validateReviewHistory(undefined, initial, questions), questions, disk)
    expect(history.rounds[0]!.wordIds).toEqual(questions.slice(0, 2).map(q => q.wordId))
    const adapter = reviewSessionStorage(history, disk, saved => { history = saved })
    const round = activeRound(history)!
    const scope = effectScope(); scopes.push(scope)
    const s = scope.run(() => useScreening(ref(roundQuestions(round, questions)), () => bundle.contentVersion, () => true, adapter))!
    await s.ready
    const q = s.question.value!
    await s.submit(q.id, q.correctOptionId)
    expect(reviewWords(initial, history).filter(w => w.needsReview).map(w => w.spelling)).toEqual(['absorb'])
    expect(reviewWords(initial, history)).toHaveLength(2)
    expect(await initialDisk.load()).toEqual(initial)
    scope.stop()
    // Close during feedback; the next visit resumes the second word, not the first.
    const restored = validateReviewHistory(await disk.load(), initial, questions)
    const scope2 = effectScope(); scopes.push(scope2)
    const s2 = scope2.run(() => useScreening(ref(roundQuestions(activeRound(restored)!, questions)), () => bundle.contentVersion, () => true, reviewSessionStorage(restored, disk, saved => { history = saved })))!
    await s2.ready
    expect(s2.question.value?.spelling).toBe('absorb')
    const second = s2.question.value!
    await s2.submit(second.id, second.options.find(o => o.id !== second.correctOptionId)!.id)
    scope2.stop()
    expect(activeRound(history)).toBeNull()
    // Next review contains only the still-wrong word.
    history = await beginReview(initial, history, questions, disk)
    expect(activeRound(history)!.wordIds).toEqual([second.wordId])
    const finalAdapter = reviewSessionStorage(history, disk, saved => { history = saved })
    const scope3 = effectScope(); scopes.push(scope3)
    const s3 = scope3.run(() => useScreening(ref([second]), () => bundle.contentVersion, () => true, finalAdapter))!
    await s3.ready
    await s3.submit(second.id, second.correctOptionId)
    expect(reviewWords(initial, history).every(w => !w.needsReview)).toBe(true)
    expect(reviewWords(initial, history)).toHaveLength(2)
    expect(validateReviewHistory(await disk.load(), initial, questions)).toEqual(history)
    await expect(beginReview(initial, history, questions, disk)).rejects.toThrow('没有待复筛')
  })

  it('复筛中的旧题目版本会在继续前完成原子迁移', async () => {
    const factory = new IDBFactory()
    const initial = initialSnapshot()
    const disk = createReviewStorage(factory)
    const current = await beginReview(initial, validateReviewHistory(undefined, initial, questions), questions, disk)
    const legacy = structuredClone(current)
    legacy.rounds[0]!.snapshot.questionSignature = 'questions-v2:2:legacy'
    await disk.save(legacy, current.revision)

    const migrated = await loadValidatedReviewHistory(createReviewStorage(factory), initial, questions)
    expect(migrated.rounds[0]!.snapshot.questionSignature).toBe(questionSignature(roundQuestions(migrated.rounds[0]!, questions)))
    expect(await disk.load()).toEqual(migrated)
  })

  it('未完成初筛或没有错词时不创建任务', async () => {
    const disk = createReviewStorage(new IDBFactory())
    const initial = initialSnapshot()
    const history = validateReviewHistory(undefined, initial, questions)
    await expect(beginReview({ ...initial, records: initial.records.slice(0, 1) }, history, questions, disk)).rejects.toThrow('先完成初筛')
    const allCorrect = { ...initial, records: initial.records.map(r => ({ ...r, result: 'correct' as const })) }
    await expect(beginReview(allCorrect, history, questions, disk)).rejects.toThrow('没有待复筛')
    expect(await disk.load()).toBeUndefined()
  })

  it('重复开始会继续现有任务，多页面并发创建只有一次成功', async () => {
    const factory = new IDBFactory()
    const disk = createReviewStorage(factory)
    const initial = initialSnapshot()
    const empty = validateReviewHistory(undefined, initial, questions)
    const results = await Promise.allSettled([beginReview(initial, empty, questions, disk), beginReview(initial, empty, questions, createReviewStorage(factory))])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const saved = validateReviewHistory(await disk.load(), initial, questions)
    expect(await beginReview(initial, saved, questions, disk)).toEqual(saved)
    expect(saved.rounds).toHaveLength(1)
  })

  it('拒绝损坏、乱序、错误关联的复筛存档，保留既有数据', async () => {
    const initial = initialSnapshot()
    const disk = createReviewStorage(new IDBFactory())
    const saved = await beginReview(initial, validateReviewHistory(undefined, initial, questions), questions, disk)
    const bad = structuredClone(saved)
    bad.rounds[0]!.wordIds.reverse()
    expect(() => validateReviewHistory(bad, initial, questions)).toThrow('不一致')
    expect(() => validateReviewHistory({ ...saved, initialTaskId: 'other-task' }, initial, questions)).toThrow('不一致')
    expect(() => validateReviewHistory({ ...saved, revision: 999 }, initial, questions)).toThrow('不一致')
    expect(await disk.load()).toEqual(saved)
  })

  it('复筛保存失败不会改变待复筛状态，重试后才更新', async () => {
    const initial = initialSnapshot()
    const disk = createReviewStorage(new IDBFactory())
    let history: ReviewHistory = await beginReview(initial, validateReviewHistory(undefined, initial, questions), questions, disk)
    let fail = true
    const adapter = reviewSessionStorage(history, { load: disk.load, save: async (...args) => { if (fail) throw new Error('disk full'); await disk.save(...args) } }, saved => { history = saved })
    const scope = effectScope(); scopes.push(scope)
    const s = scope.run(() => useScreening(ref(roundQuestions(activeRound(history)!, questions)), () => bundle.contentVersion, () => true, adapter))!
    await s.ready
    const q = s.question.value!
    await s.submit(q.id, q.correctOptionId)
    expect(s.phase.value).toBe('error')
    expect(reviewWords(initial, history).filter(w => w.needsReview)).toHaveLength(2)
    fail = false
    await s.savePending()
    expect(reviewWords(initial, history).filter(w => w.needsReview)).toHaveLength(1)
  })
})
