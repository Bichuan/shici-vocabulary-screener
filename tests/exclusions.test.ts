import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { excludeApprovedWords } from '../src/domain/exclusions.ts'
import { validateVocabulary } from '../src/domain/vocabulary.ts'

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const { words } = validateVocabulary(json('../data/upstream/netem_full_list.json'))
const approved = json('../data/config/excluded-basic-words.json') as { wordIds: string[] }
const candidates = json('../data/review/basic-200-candidates.json') as { words: { id: string }[] }
const rare = json('../data/config/excluded-rare-words.json') as { enabled: boolean; wordIds: string[] }
const extra = json('../data/config/excluded-low-frequency-extra.json') as { enabled: boolean; wordIds: string[] }
const rareCandidates = json('../data/review/low-frequency-candidates.json') as { words: { id: string; frequency: number }[] }

describe('已确认的 200 词删除', () => {
  it('仅移除已确认的词，保留其余词的 ID、释义和顺序', () => {
    expect(approved.wordIds).toEqual(candidates.words.map(word => word.id))
    const active = excludeApprovedWords(words, approved.wordIds, 200)
    expect(active).toHaveLength(5330)
    expect(active).toEqual(words.filter(word => !approved.wordIds.includes(word.id)))
    for (const spelling of ['a', 'the', 'apple']) expect(active.some(word => word.spelling === spelling)).toBe(false)
    for (const spelling of ['abandon', 'book', 'mine', 'light', 'May', 'may']) expect(active.some(word => word.spelling === spelling)).toBe(true)
    expect(words).toHaveLength(5530)
  })
  it('拒绝重复、缺失和数量变化的排除配置', () => {
    expect(() => excludeApprovedWords(words, ['netem:a', 'netem:a'], 2)).toThrow()
    expect(() => excludeApprovedWords(words, ['netem:missing-word'], 1)).toThrow()
    expect(() => excludeApprovedWords(words, approved.wordIds.slice(1), 200)).toThrow()
  })
  it('重新导入后的浏览器词库与筛选结果完全一致', () => {
    const bundle = json('../public/data/vocabulary.json')
    const basicFiltered = excludeApprovedWords(words, approved.wordIds, 200)
    const afterRare = rare.enabled ? excludeApprovedWords(basicFiltered, rare.wordIds, 50) : basicFiltered
    const expected = extra.enabled ? excludeApprovedWords(afterRare, extra.wordIds, 60) : afterRare
    expect(bundle.words).toEqual(expected)
    const removed = 200 + (rare.enabled ? 50 : 0) + (extra.enabled ? 60 : 0)
    expect(bundle.report.importedCount).toBe(5530 - removed)
    expect(bundle.report.excludedCount).toBe(removed)
    expect(bundle.report.sourceCount).toBe(5530)
    expect(bundle.contentVersion).toContain(':exclude-')
  })
  it('50 个低频词来自已审核候选，不重叠且不误删通用学术词', () => {
    expect(rare.wordIds).toHaveLength(50)
    for (const id of rare.wordIds) {
      expect(approved.wordIds).not.toContain(id)
      expect(rareCandidates.words.find(word => word.id === id)?.frequency).toBeLessThanOrEqual(2)
    }
    const basicFiltered = excludeApprovedWords(words, approved.wordIds, 200)
    const filtered = excludeApprovedWords(basicFiltered, rare.wordIds, 50)
    expect(filtered).toHaveLength(5280)
    for (const spelling of ['qualitative', 'configuration', 'variance', 'data', 'means', 'species']) {
      expect(filtered.some(word => word.spelling === spelling)).toBe(true)
    }
    for (const spelling of ['quart', 'watt', 'volt', 'horsepower']) expect(filtered.some(word => word.spelling === spelling)).toBe(false)
    expect(basicFiltered).toHaveLength(5330)
  })
  it('追加 60 词属于原最低频 447 词，三份排除表不重叠', () => {
    const afterBasic = excludeApprovedWords(words, approved.wordIds, 200)
    const low = afterBasic.filter(word => word.frequency <= 2)
    expect(low).toHaveLength(447)
    expect(extra.wordIds).toHaveLength(60)
    const allIds = [...approved.wordIds, ...rare.wordIds, ...extra.wordIds]
    expect(new Set(allIds).size).toBe(310)
    for (const id of extra.wordIds) expect(low.some(word => word.id === id)).toBe(true)
    const active = excludeApprovedWords(words, allIds, 310)
    expect(active).toHaveLength(5220)
    expect(active.filter(word => word.frequency <= 2)).toHaveLength(337)
    for (const spelling of ['qualitative', 'configuration', 'variance', 'data', 'means', 'species']) {
      expect(active.some(word => word.spelling === spelling)).toBe(true)
    }
  })
})
