import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateVocabulary, wordId } from '../src/domain/vocabulary.ts'

const row = (word: string, meaning: string, order = 1) => ({
  单词: word, 释义: meaning, 序号: order, 词频: 0, 其他拼写: null, 分类: null, 子分类: null,
})
const input = (...rows: unknown[]) => ({ '5530考研词汇词频排序表': rows })

describe('词库导入边界', () => {
  it('保留大小写不同且含义不同的词，不按小写误删', () => {
    const { words, report } = validateVocabulary(input(row('may', '可能'), row('May', '五月', 2)), 2)
    expect(words).toHaveLength(2)
    expect(words[0]!.id).not.toBe(words[1]!.id)
    expect(report.errorCount).toBe(0)
    expect(report.issues[0]!.code).toBe('CASE_VARIANT')
  })
  it('同拼写重复时拒绝静默丢弃或覆盖', () => {
    const { report } = validateVocabulary(input(row(' word ', '单词'), row('word', '词语', 2)), 2)
    expect(report.duplicateCount).toBe(1)
    expect(report.errorCount).toBe(1)
  })
  it('拒绝空释义、错误结构和数量不足', () => {
    expect(validateVocabulary(input(row('word', '  ')), 1).report.emptyMeaningCount).toBe(1)
    expect(validateVocabulary([]).report.errorCount).toBeGreaterThan(0)
    expect(validateVocabulary(input(row('word', '单词')), 2).report.issues.some(i => i.code === 'COUNT_MISMATCH')).toBe(true)
  })
  it('稳定标识不随顺序变化，保留原始简短释义', () => {
    const first = validateVocabulary(input(row('abandon', '抛弃')), 1).words[0]!
    const reordered = validateVocabulary(input(row('abandon', '抛弃', 10)), 1).words[0]!
    expect(first.id).toBe(reordered.id)
    expect(first.id).toBe(wordId('abandon'))
    expect(first.meaning).toBe('抛弃')
  })
  it('实际固定词库完整导入且标识唯一', () => {
    const data = JSON.parse(readFileSync(new URL('../data/upstream/netem_full_list.json', import.meta.url), 'utf8'))
    const { words, report } = validateVocabulary(data)
    expect(report.errorCount).toBe(0)
    expect(words).toHaveLength(5530)
    expect(new Set(words.map(w => w.id)).size).toBe(5530)
    expect(words.find(w => w.spelling === 'abandon')?.meaning).toBe('抛弃')
  })
})
