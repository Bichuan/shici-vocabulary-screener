import { readFileSync } from 'node:fs'
import { IDBFactory } from 'fake-indexeddb'
import { effectScope, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildQuestions } from '../src/domain/questions.ts'
import { learningKeys } from '../src/domain/learningNamespace.ts'
import { createIndexedDBStorage, questionSignature, type ScreeningSnapshot } from '../src/domain/screeningStorage.ts'
import { activeRound, beginReview, createReviewStorage, reviewSessionStorage, reviewWords, roundQuestions, validateReviewHistory, type ReviewHistory } from '../src/domain/review.ts'
import { backupFileName, csvFileName, readLearningBackup, restoreLearningBackup, screeningBackupFileName, validateLearningBackup } from '../src/domain/studyTools.ts'
import { useScreening } from '../src/domain/useScreening.ts'

const root = new URL('../', import.meta.url)
const netem = JSON.parse(readFileSync(new URL('public/data/vocabulary.json', root), 'utf8')) as VocabularyBundle
const cet = JSON.parse(readFileSync(new URL('public/data/cet-vocabulary.json', root), 'utf8')) as VocabularyBundle
const netemQuestions = buildQuestions(netem.words, () => 0.999999, false).slice(0, 2)
const cetQuestions = buildQuestions(cet.words, () => 0.999999, false).slice(0, 2)

function snapshot(bundle: VocabularyBundle, questions: typeof netemQuestions, count: number): ScreeningSnapshot {
  const taskId = crypto.randomUUID()
  return {
    schemaVersion: 1,
    dictionaryVersion: bundle.contentVersion,
    questionSignature: questionSignature(questions),
    taskId,
    revision: count,
    records: questions.slice(0, count).map(question => {
      const option = question.options.find(item => item.id !== question.correctOptionId)!
      return {
        id: crypto.randomUUID(), taskId, wordId: question.wordId, dictionaryVersion: bundle.contentVersion,
        questionVersion: question.version, selectedOptionId: option.id, result: 'wrong' as const,
        answeredAt: '2026-09-29T00:00:00.000Z', spelling: question.spelling,
        coreMeaning: question.coreMeaning, selectedMeaning: option.text,
      }
    }),
  }
}

describe('双词库学习记录隔离', () => {
  it('沿用考研旧键，六级使用独立的初筛、复筛和存储代次键', () => {
    expect(learningKeys('netem-2024')).toEqual({
      initial: 'initial-screening', review: 'review-history', beforeRestore: 'before-restore', generation: 'storage-generation',
    })
    expect(new Set([...Object.values(learningKeys('netem-2024')), ...Object.values(learningKeys('cet6-2016-curated'))]).size).toBe(8)
  })

  it('两词库各自读写；恢复六级备份不会覆盖考研或使考研页面失效', async () => {
    const factory = new IDBFactory()
    const netemStore = createIndexedDBStorage(factory)
    const cetStore = createIndexedDBStorage(factory, 'shici-learning', 'cet6-2016-curated')
    const netemFirst = snapshot(netem, netemQuestions, 1)
    const cetFirst = snapshot(cet, cetQuestions, 1)
    await netemStore.save(netemFirst, 0)
    await cetStore.save(cetFirst, 0)
    await netemStore.load() // A tab already open before CET restore.
    const cetArchive = await readLearningBackup(factory, cet.contentVersion, 'cet6-2016-curated')
    expect(cetArchive.dictionaryId).toBe('cet6-2016-curated')
    expect((await readLearningBackup(factory, netem.contentVersion)).initial).toEqual(netemFirst)
    const cetSecond = { ...cetArchive, initial: snapshot(cet, cetQuestions, 2) }
    await restoreLearningBackup(cetSecond, factory, cetArchive, 'cet6-2016-curated')
    const netemSecond = { ...netemFirst, revision: 2, records: snapshot(netem, netemQuestions, 2).records.map(record => ({ ...record, taskId: netemFirst.taskId })) }
    await netemStore.save(netemSecond, 1)
    expect((await readLearningBackup(factory, netem.contentVersion)).initial).toEqual(netemSecond)
    expect((await readLearningBackup(factory, cet.contentVersion, 'cet6-2016-curated')).initial).toEqual(cetSecond.initial)
  })

  it('复筛存档分别写入对应键', async () => {
    const factory = new IDBFactory()
    const netemReview: ReviewHistory = { schemaVersion: 1, initialTaskId: 'netem-task', revision: 0, rounds: [] }
    const cetReview: ReviewHistory = { schemaVersion: 1, initialTaskId: 'cet-task', revision: 0, rounds: [] }
    const first = createReviewStorage(factory)
    const second = createReviewStorage(factory, 'shici-learning', 'cet6-2016-curated')
    await first.save(netemReview, 0)
    await second.save(cetReview, 0)
    expect(await first.load()).toEqual(netemReview)
    expect(await second.load()).toEqual(cetReview)
  })

  it('六级完整初筛后可独立复筛，答对只更新六级错词状态', async () => {
    const factory = new IDBFactory()
    const initial = snapshot(cet, cetQuestions, 2)
    const initialStore = createIndexedDBStorage(factory, 'shici-learning', 'cet6-2016-curated')
    await initialStore.save(initial, 0)
    const disk = createReviewStorage(factory, 'shici-learning', 'cet6-2016-curated')
    let history = await beginReview(initial, validateReviewHistory(undefined, initial, cetQuestions), cetQuestions, disk)
    const round = activeRound(history)!
    const scope = effectScope()
    try {
      const session = scope.run(() => useScreening(ref(roundQuestions(round, cetQuestions)), () => cet.contentVersion, () => true,
        reviewSessionStorage(history, disk, saved => { history = saved }), 'cet6-2016-curated'))!
      await session.ready
      const question = session.question.value!
      await session.submit(question.id, question.correctOptionId)
      expect(reviewWords(initial, history).filter(word => word.needsReview)).toHaveLength(1)
      expect(await initialStore.load()).toEqual(initial)
      expect(await createReviewStorage(factory).load()).toBeUndefined()
    } finally { scope.stop() }
  })

  it('六级随机混排保留题目签名，前段抽到不同词频层', () => {
    const mixed = buildQuestions(cet.words, () => 0.999999, true)
    const byOrder = new Map(cet.words.map(word => [word.id, word.sourceOrder]))
    const first = mixed.slice(0, 100).map(question => byOrder.get(question.wordId)!)
    expect(questionSignature(mixed)).toBe(questionSignature(buildQuestions(cet.words, () => 0.999999, false)))
    expect(Math.min(...first)).toBeLessThan(800)
    expect(Math.max(...first)).toBeGreaterThan(4000)
  })

  it('旧考研备份仍可恢复，跨词库恢复必须在写入前拒绝', async () => {
    const factory = new IDBFactory()
    const old = { schemaVersion: 1 as const, createdAt: '2026-09-29T00:00:00.000Z', dictionaryVersion: netem.contentVersion,
      initial: snapshot(netem, netemQuestions, 1), review: null }
    expect(validateLearningBackup(old, netem.contentVersion, netemQuestions).dictionaryId).toBe('netem-2024')
    expect(() => validateLearningBackup(old, cet.contentVersion, cetQuestions, 'cet6-2016-curated')).toThrow('其他词库')
    await expect(restoreLearningBackup(old, factory, undefined, 'cet6-2016-curated')).rejects.toThrow('其他词库')
    const cetBackup = { schemaVersion: 1 as const, createdAt: '2026-09-29T00:00:00.000Z', dictionaryId: 'cet6-2016-curated' as const,
      dictionaryVersion: cet.contentVersion, initial: snapshot(cet, cetQuestions, 1), review: null }
    expect(() => validateLearningBackup(cetBackup, netem.contentVersion, netemQuestions)).toThrow('其他词库')
    await expect(restoreLearningBackup(cetBackup, factory)).rejects.toThrow('其他词库')
    expect((await readLearningBackup(factory, cet.contentVersion, 'cet6-2016-curated')).initial).toBeNull()
    await restoreLearningBackup(old, factory)
    expect((await readLearningBackup(factory, netem.contentVersion)).initial).toEqual(old.initial)
  })

  it('新下载文件名标识词库，旧命名方式仍可使用', () => {
    const date = new Date('2026-09-29T03:25:00.000Z')
    expect(backupFileName(date, 'cet6-2016-curated')).toContain('六级-学习备份')
    expect(csvFileName(date, 'netem-2024')).toContain('考研-错词背诵')
    expect(screeningBackupFileName(200, date, 'cet6-2016-curated')).toContain('六级-筛查备份-200词')
    expect(backupFileName(date)).toBe('拾词-学习备份-2026-09-29.json')
  })
})
