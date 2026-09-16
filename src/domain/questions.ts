import type { VocabularyWord } from './types.ts'
import { sampleGroups } from './questionSamples.ts'

export interface QuestionOption { id: string; text: string }
export interface ScreeningQuestion {
  id: string
  version: string
  wordId: string
  spelling: string
  partOfSpeech: string
  coreMeaning: string
  options: QuestionOption[]
  correctOptionId: string
}

export const QUESTION_VERSION = 'source-meanings-v2'
export const SAMPLE_VERSION = QUESTION_VERSION
export const LEGACY_SAMPLE_VERSION = 'day2-core-v1'
export const PREVIOUS_QUESTION_VERSIONS = ['source-meanings-v1', LEGACY_SAMPLE_VERSION] as const
export const LEGACY_SAMPLE_ORDER = sampleGroups.flatMap(group => group.entries.map(([spelling]) => spelling))

// Manually reviewed pairs whose source meanings can both reasonably answer the
// same English word. They remain in the dictionary, but never appear together
// in one question. See data/review/BIC-22-语义抽查.md.
export const SEMANTIC_CONFLICT_GROUPS = [
  ['relate', 'tell'],
  ['quiet', 'silent'],
  ['zone', 'area'],
  ['drawback', 'handicap'],
  ['juvenile', 'kid'],
  ['quantify', 'measure'],
  ['decree', 'statute'],
] as const

const semanticGroupsBySpelling = new Map<string, Set<number>>()
for (const [groupIndex, group] of SEMANTIC_CONFLICT_GROUPS.entries()) {
  for (const spelling of group) {
    const key = spelling.toLocaleLowerCase('en-US')
    const memberships = semanticGroupsBySpelling.get(key) ?? new Set<number>()
    memberships.add(groupIndex)
    semanticGroupsBySpelling.set(key, memberships)
  }
}

function hasSemanticConflict(left: VocabularyWord, right: VocabularyWord) {
  const leftGroups = semanticGroupsBySpelling.get(left.spelling.toLocaleLowerCase('en-US'))
  const rightGroups = semanticGroupsBySpelling.get(right.spelling.toLocaleLowerCase('en-US'))
  return !!leftGroups && !!rightGroups && [...leftGroups].some(group => rightGroups.has(group))
}

const normalizeMeaning = (text: string) => text.normalize('NFKC').trim()
const meaningParts = (text: string) => new Set(normalizeMeaning(text).split(/[、，,；;\/\s]+/u).map(part => part.replace(/[.…·]/gu, '')).filter(Boolean))
function overlapsMeaning(left: string, right: string) {
  const a = meaningParts(left)
  return [...meaningParts(right)].some(part => a.has(part))
}

// 洗牌只发生在进入一道题时，不因点击选项或组件重渲染而改变。
export function shuffleOptions<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机数必须在 [0, 1) 内')
    const j = Math.floor(value * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

export function validateQuestions(questions: ScreeningQuestion[], words: VocabularyWord[]): string[] {
  const issues: string[] = []
  const vocabulary = new Map(words.map(word => [word.id, word]))
  const sourceMeanings = new Set(words.map(word => normalizeMeaning(word.meaning)))
  const seen = new Set<string>()
  for (const question of questions) {
    const fail = (message: string) => issues.push(`${question.spelling}: ${message}`)
    if (seen.has(question.wordId)) fail('重复题目')
    seen.add(question.wordId)
    const word = vocabulary.get(question.wordId)
    if (!word || word.spelling !== question.spelling) fail('单词不在当前词库')
    if (word && normalizeMeaning(question.coreMeaning) !== normalizeMeaning(word.meaning)) fail('正确释义不是原始词表释义')
    if (question.options.length !== 8) fail('必须有八个选项')
    const texts = question.options.map(option => normalizeMeaning(option.text))
    if (texts.some(text => !text) || new Set(texts).size !== 8) fail('释义为空或重复')
    if (texts.some(text => !sourceMeanings.has(text))) fail('选项包含原始词表之外的释义')
    if (new Set(question.options.map(option => option.id)).size !== 8) fail('选项标识重复')
    const answers = question.options.filter(option => option.id === question.correctOptionId)
    if (answers.length !== 1 || normalizeMeaning(answers[0]?.text ?? '') !== normalizeMeaning(question.coreMeaning)) fail('正确答案必须唯一且与核心义一致')
  }
  return issues
}

function orderedWords(words: VocabularyWord[]) {
  const legacyPosition = new Map<string, number>(LEGACY_SAMPLE_ORDER.map((spelling, index) => [spelling, index]))
  return [...words].sort((a, b) => {
    const ai = legacyPosition.get(a.spelling)
    const bi = legacyPosition.get(b.spelling)
    if (ai !== undefined || bi !== undefined) return ai === undefined ? 1 : bi === undefined ? -1 : ai - bi
    return a.sourceOrder - b.sourceOrder
  })
}

function chooseDistractors(target: VocabularyWord, words: VocabularyWord[], pools: Map<string, VocabularyWord[]>) {
  const selected: VocabularyWord[] = []
  const meanings = new Set([normalizeMeaning(target.meaning)])
  const add = (pool: VocabularyWord[], rejectOverlap: boolean) => {
    if (!pool.length || selected.length === 7) return
    const start = Math.abs(target.sourceOrder) % pool.length
    for (let offset = 0; offset < pool.length && selected.length < 7; offset++) {
      const candidate = pool[(start + offset) % pool.length]!
      const meaning = normalizeMeaning(candidate.meaning)
      if (candidate.id === target.id || meanings.has(meaning) || hasSemanticConflict(target, candidate) || (rejectOverlap && overlapsMeaning(target.meaning, candidate.meaning))) continue
      meanings.add(meaning)
      selected.push(candidate)
    }
  }
  if (target.subcategory) add(pools.get(`subcategory:${target.subcategory}`) ?? [], true)
  if (target.category) add(pools.get(`category:${target.category}`) ?? [], true)
  add(words, true)
  if (selected.length < 7 && target.category) add(pools.get(`category:${target.category}`) ?? [], false)
  if (selected.length < 7) add(words, false)
  if (selected.length !== 7) throw new Error(`词库中没有足够的不同原始释义为 ${target.spelling} 生成八选一题目`)
  return selected
}

/** Every correct answer and distractor is copied from an active upstream row. */
function initialLetter(question: ScreeningQuestion) {
  return question.spelling.match(/[a-z]/iu)?.[0]?.toUpperCase() ?? '#'
}

function interleaveInitials(items: ScreeningQuestion[], random: () => number, previousInitial = '') {
  const groups = new Map<string, ScreeningQuestion[]>()
  for (const question of items) {
    const initial = initialLetter(question)
    groups.set(initial, [...(groups.get(initial) ?? []), question])
  }
  for (const [initial, group] of groups) groups.set(initial, shuffleOptions(group, random))
  const result: ScreeningQuestion[] = []
  let lastInitial = previousInitial
  while (groups.size) {
    const initials = shuffleOptions([...groups.keys()], random)
    if (initials.length > 1 && initials[0] === lastInitial) [initials[0], initials[1]] = [initials[1]!, initials[0]!]
    for (const initial of initials) {
      const group = groups.get(initial)!
      const question = group.shift()!
      result.push(question)
      lastInitial = initial
      if (!group.length) groups.delete(initial)
    }
  }
  return result
}

export function buildQuestions(words: VocabularyWord[], random: () => number = Math.random, randomizeOrder = true): ScreeningQuestion[] {
  const ordered = orderedWords(words)
  const pools = new Map<string, VocabularyWord[]>()
  for (const word of ordered) {
    for (const key of [word.category && `category:${word.category}`, word.subcategory && `subcategory:${word.subcategory}`].filter(Boolean) as string[]) {
      const pool = pools.get(key) ?? []
      pool.push(word)
      pools.set(key, pool)
    }
  }
  const questions = ordered.map(word => {
    const sourceOptions = [word, ...chooseDistractors(word, ordered, pools)]
    const options = sourceOptions.map(option => ({ id: `source:${option.id}`, text: option.meaning }))
    return {
      id: `${QUESTION_VERSION}:${word.id}`,
      version: QUESTION_VERSION,
      wordId: word.id,
      spelling: word.spelling,
      partOfSpeech: word.subcategory ?? word.category ?? '原始词表',
      coreMeaning: word.meaning,
      options,
      correctOptionId: options[0]!.id,
    }
  })
  const issues = validateQuestions(questions, words)
  if (issues.length) throw new Error(issues.join('\n'))
  if (!randomizeOrder) return questions
  const randomized: ScreeningQuestion[] = []
  // Keep broad frequency progression while alternating initial letters inside
  // each band, so similar spellings are less likely to appear together.
  for (let start = 0; start < questions.length; start += 80) {
    const previous = randomized.at(-1)
    randomized.push(...interleaveInitials(questions.slice(start, start + 80), random, previous ? initialLetter(previous) : ''))
  }
  return randomized
}

/** Compatibility name retained for existing imports. */
export const buildSampleQuestions = buildQuestions
