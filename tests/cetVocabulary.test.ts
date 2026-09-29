import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cetWordId, validateCetVocabulary } from '../src/domain/cetVocabulary.ts'
import { excludeApprovedWords } from '../src/domain/exclusions.ts'
import { buildQuestions } from '../src/domain/questions.ts'

const root = new URL('../', import.meta.url)
const source = JSON.parse(readFileSync(new URL('data/upstream/cet/cet_full_list.json', root), 'utf8'))
const exclusions = JSON.parse(readFileSync(new URL('data/config/cet-exclusions.json', root), 'utf8')) as {
  basicWordIds: string[]
  rareWordIds: string[]
}

describe('六级精选词库', () => {
  it('完整读取固定原表，并为六级词生成独立于考研的稳定 ID', () => {
    const { words, sixLevelIds, report } = validateCetVocabulary(source)
    expect(report.errorCount).toBe(0)
    expect(words).toHaveLength(5278)
    expect(sixLevelIds.size).toBe(1253)
    expect(cetWordId('abandon')).toBe('cet:abandon')
    expect(words.find(word => word.spelling === 'abandon')?.id).not.toBe('netem:abandon')
  })

  it('排除清单不重叠、不含缺失词，考研发布词库仍为 5220 词', () => {
    const { words, sixLevelIds } = validateCetVocabulary(source)
    const afterBasic = excludeApprovedWords(words, exclusions.basicWordIds, 437)
    const active = excludeApprovedWords(afterBasic, exclusions.rareWordIds, 122)
    expect(active).toHaveLength(4719)
    expect(active.filter(word => sixLevelIds.has(word.id))).toHaveLength(1189)
    const netem = JSON.parse(readFileSync(new URL('public/data/vocabulary.json', root), 'utf8')) as { dictionaryId: string; words: unknown[] }
    expect(netem.dictionaryId).toBe('netem-2024')
    expect(netem.words).toHaveLength(5220)
  })

  it('六级的近义干扰项不与正确释义同时出现', () => {
    const bundle = JSON.parse(readFileSync(new URL('public/data/cet-vocabulary.json', root), 'utf8')) as { words: ReturnType<typeof validateCetVocabulary>['words'] }
    const question = buildQuestions(bundle.words, () => 0.999999, false).find(item => item.spelling === 'spend')!
    expect(question.coreMeaning).toBe('花')
    expect(question.options.map(option => option.text)).not.toContain('花费')
  })
})
