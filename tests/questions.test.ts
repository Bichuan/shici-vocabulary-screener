import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildSampleQuestions, shuffleOptions, validateQuestions } from '../src/domain/questions.ts'

const bundle = JSON.parse(readFileSync(new URL('../public/data/vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle

describe('八选一题目边界', () => {
  it('全部词均生成题目，每个正确项和干扰项都来自原始词表', () => {
    const questions = buildSampleQuestions(bundle.words, () => 0.999999, false)
    const sourceMeanings = new Set(bundle.words.map(word => word.meaning))
    expect(questions).toHaveLength(bundle.words.length)
    expect(validateQuestions(questions, bundle.words)).toEqual([])
    expect(questions.every(q => q.options.length === 8 && new Set(q.options.map(option => option.text)).size === 8)).toBe(true)
    expect(questions.every(q => q.options.every(option => sourceMeanings.has(option.text)))).toBe(true)
    expect(questions.every(q => q.coreMeaning === bundle.words.find(word => word.id === q.wordId)?.meaning)).toBe(true)
    expect(questions[0]?.coreMeaning).toBe('抛弃')
  })
  it('词库不足八种不同释义时拒绝生成不完整题目', () => {
    expect(() => buildSampleQuestions(bundle.words.slice(0, 7), () => 0.999999, false)).toThrow('没有足够的不同原始释义')
  })
  it('拒绝重复选项、答案丢失、重复题及未知单词', () => {
    const questions = buildSampleQuestions(bundle.words, () => 0.999999, false)
    const first = questions[0]!
    first.options[1] = { ...first.options[0]!, text: '原表中不存在的释义' }
    first.correctOptionId = 'missing'
    first.wordId = 'missing'
    questions.push(first)
    const errors = validateQuestions(questions, bundle.words).join('\n')
    for (const message of ['选项包含原始词表之外的释义', '选项标识重复', '正确答案必须唯一', '重复题目', '单词不在当前词库']) expect(errors).toContain(message)
  })
  it('洗牌不修改题目或丢失答案，正确选项可出现在所有八个位置', () => {
    const question = buildSampleQuestions(bundle.words, () => 0.999999, false)[0]!
    const original = structuredClone(question.options)
    const positions = new Set<number>()
    for (let i = 0; i < 100; i++) {
      const options = shuffleOptions(question.options, () => i / 100)
      expect(new Set(options.map(o => o.id))).toEqual(new Set(original.map(o => o.id)))
      positions.add(options.findIndex(o => o.id === question.correctOptionId))
    }
    expect(positions.size).toBe(8)
    expect(question.options).toEqual(original)
    expect(() => shuffleOptions(original, () => 1)).toThrow()
  })
  it('只在每 80 词的相近词频区间内打乱题序', () => {
    const original = buildSampleQuestions(bundle.words, () => 0.999999, false)
    const randomized = buildSampleQuestions(bundle.words, () => 0, true)
    expect(randomized.map(question => question.wordId)).not.toEqual(original.map(question => question.wordId))
    for (let start = 0; start < original.length; start += 80) {
      expect(new Set(randomized.slice(start, start + 80).map(question => question.wordId)))
        .toEqual(new Set(original.slice(start, start + 80).map(question => question.wordId)))
    }
  })
})
