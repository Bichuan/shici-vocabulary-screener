import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildSampleQuestions } from '../src/domain/questions.ts'
import { createIndexedDBStorage, questionSignature, type ScreeningSnapshot } from '../src/domain/screeningStorage.ts'
import { createMemorizationCsv, historicalWrongWords, readLearningBackup, restoreLearningBackup, screeningBackupFileName, validateLearningBackup } from '../src/domain/studyTools.ts'

const bundle = JSON.parse(readFileSync(new URL('../public/data/vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle
const questions = buildSampleQuestions(bundle.words, () => 0.999999, false).slice(0, 2)
function snapshot(result: 'correct' | 'wrong' = 'wrong'): ScreeningSnapshot {
  const taskId = crypto.randomUUID()
  return { schemaVersion: 1, taskId, revision: 2, dictionaryVersion: bundle.contentVersion, questionSignature: questionSignature(questions), records: questions.map(question => {
    const option = result === 'correct' ? question.options.find(o => o.id === question.correctOptionId)! : question.options.find(o => o.id !== question.correctOptionId)!
    return { id: crypto.randomUUID(), taskId, wordId: question.wordId, dictionaryVersion: bundle.contentVersion, questionVersion: question.version, selectedOptionId: option.id, result, answeredAt: '2026-09-13T00:00:00.000Z', spelling: question.spelling, coreMeaning: question.coreMeaning, selectedMeaning: option.text }
  }) }
}

describe('导出与备份', () => {
  it('筛查备份文件名包含已筛词数和时间，便于分别保存多次记录', () => {
    expect(screeningBackupFileName(200, new Date('2026-09-14T03:25:00.000Z'))).toBe('拾词-筛查备份-200词-2026-09-14-0325.json')
  })

  it('导出为带 BOM 的三列表格，转义引号并防止 Excel 将词义当公式', () => {
    const csv = createMemorizationCsv([{ spelling: ' =SUM(A1:A2)', coreMeaning: '“引号”, +公式' }])
    expect(csv).toBe('\uFEFF"序号","英文单词","正确核心义"\r\n"1","\' =SUM(A1:A2)","“引号”, +公式"\r\n')
  })

  it('空复筛历史仍导出初筛历史错词，复筛状态不影响导出范围', () => {
    const initial = snapshot()
    const backup = { schemaVersion: 1 as const, createdAt: '2026-09-13T00:00:00.000Z', dictionaryVersion: bundle.contentVersion, initial, review: null }
    expect(historicalWrongWords(backup)).toEqual([{ spelling: 'abandon', coreMeaning: '抛弃' }, { spelling: 'absorb', coreMeaning: '吸收' }])
  })

  it('备份读取与恢复同时处理初筛和复筛键，恢复后可按当前题库验证', async () => {
    const factory = new IDBFactory()
    const disk = createIndexedDBStorage(factory)
    const first = snapshot('correct')
    await disk.save(first, 0)
    const backup = await readLearningBackup(factory)
    expect(backup.initial).toEqual(first)
    expect(backup.review).toBeNull()
    const second = snapshot('wrong')
    await restoreLearningBackup({ ...backup, initial: second }, factory)
    const restored = await readLearningBackup(factory)
    expect(restored.initial).toEqual(second)
    expect(restored.review).toBeNull()
    expect(validateLearningBackup(restored, bundle.contentVersion, questions).initial).toEqual(second)
  })

  it('拒绝错词库版本、损坏时间和孤立复筛记录，不改变现有备份', () => {
    const valid = { schemaVersion: 1 as const, createdAt: '2026-09-13T00:00:00.000Z', dictionaryVersion: bundle.contentVersion, initial: snapshot(), review: null }
    expect(() => validateLearningBackup({ ...valid, dictionaryVersion: 'old' }, bundle.contentVersion, questions)).toThrow('格式')
    expect(() => validateLearningBackup({ ...valid, createdAt: 'not-date' }, bundle.contentVersion, questions)).toThrow('格式')
    expect(() => validateLearningBackup({ ...valid, initial: null, review: { anything: true } }, bundle.contentVersion, questions)).toThrow('格式')
  })

  it('空存档可读取和备份，未完成初筛的备份可重复校验与恢复', async () => {
    const factory = new IDBFactory()
    const empty = await readLearningBackup(factory, bundle.contentVersion)
    expect(validateLearningBackup(empty, bundle.contentVersion, questions).initial).toBeNull()
    const initial = snapshot()
    initial.records = initial.records.slice(0, 1)
    initial.revision = 1
    await createIndexedDBStorage(factory).save(initial, 0)
    const saved = validateLearningBackup(await readLearningBackup(factory), bundle.contentVersion, questions)
    expect(saved.review).toBeNull()
    const reloaded = validateLearningBackup(JSON.parse(JSON.stringify(saved)), bundle.contentVersion, questions)
    await restoreLearningBackup(reloaded, factory)
    expect((await readLearningBackup(factory)).initial?.records).toHaveLength(1)
    // Day 6 exported an empty review object even for partial initial progress.
    expect(validateLearningBackup({ ...saved, review: { schemaVersion: 1, initialTaskId: initial.taskId, revision: 0, rounds: [] } }, bundle.contentVersion, questions).initial?.revision).toBe(1)
  })

  it('恢复后旧页面不能用相同任务和修订号继续覆盖进度', async () => {
    const factory = new IDBFactory()
    const initial = snapshot()
    const disk = createIndexedDBStorage(factory)
    await disk.save(initial, 0)
    await disk.load()
    const archive = await readLearningBackup(factory)
    await restoreLearningBackup(archive, factory, archive)
    await expect(disk.save(initial, initial.revision)).rejects.toThrow('另一个页面')
    expect((await readLearningBackup(factory)).initial).toEqual(initial)
  })

  it('确认恢复期间已有新答案提交时取消覆盖', async () => {
    const factory = new IDBFactory()
    const disk = createIndexedDBStorage(factory)
    const first = snapshot()
    first.records = first.records.slice(0, 1); first.revision = 1
    await disk.save(first, 0)
    const expected = await readLearningBackup(factory)
    const secondRecord = { ...snapshot().records[1]!, taskId: first.taskId }
    await disk.save({ ...first, records: [...first.records, secondRecord], revision: 2 }, 1)
    await expect(restoreLearningBackup(expected, factory, expected)).rejects.toThrow('另一个页面')
    expect((await readLearningBackup(factory)).initial?.revision).toBe(2)
  })

  it('CSV 正确转义英文引号、逗号和换行', () => {
    expect(createMemorizationCsv([{ spelling: 'test', coreMeaning: 'say "hi",\n你好' }])).toContain('"say ""hi"",\n你好"')
  })
})
