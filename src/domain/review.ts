import type { ScreeningQuestion } from './questions.ts'
import { createRevisionStorage, questionSignature, StorageConflict, validateSnapshot, type RevisionStorage, type ScreeningSnapshot, type ScreeningStorage } from './screeningStorage.ts'

export interface ReviewRound { wordIds: string[]; snapshot: ScreeningSnapshot }
export interface ReviewHistory {
  schemaVersion: 1
  initialTaskId: string
  revision: number
  rounds: ReviewRound[]
}
export const createReviewStorage = (factory: IDBFactory = indexedDB, databaseName = 'shici-learning') =>
  createRevisionStorage<ReviewHistory>('review-history', factory, databaseName, (a, b) => a.initialTaskId === b.initialTaskId)

export function reviewWords(initial: ScreeningSnapshot, history: ReviewHistory) {
  const words = new Map(initial.records.filter(r => r.result === 'wrong').map(r => [r.wordId, { ...r, needsReview: true }]))
  for (const round of history.rounds) for (const record of round.snapshot.records) {
    const word = words.get(record.wordId)
    if (word) word.needsReview = record.result === 'wrong'
  }
  return [...words.values()]
}
export function roundQuestions(round: ReviewRound, questions: ScreeningQuestion[]) {
  const byId = new Map(questions.map(q => [q.wordId, q]))
  return round.wordIds.map(id => {
    const question = byId.get(id)
    if (!question) throw new Error('复筛题目不在当前词库，原存档已保留。')
    return question
  })
}
export function activeRound(history: ReviewHistory) {
  const last = history.rounds.at(-1)
  return last && last.snapshot.records.length < last.wordIds.length ? last : null
}
export function validateReviewHistory(raw: unknown, initial: ScreeningSnapshot, questions: ScreeningQuestion[]): ReviewHistory {
  if (raw === undefined || raw === null) return { schemaVersion: 1, initialTaskId: initial.taskId, revision: 0, rounds: [] }
  const history = raw as ReviewHistory
  const invalid = () => { throw new Error('复筛存档不完整或与初筛不一致，原记录已保留。') }
  const questionIds = new Set(questions.map(question => question.wordId))
  const legacyCompleted = initial.records.length === 48 && initial.records.every(record => questionIds.has(record.wordId))
  if (history.schemaVersion !== 1 || history.initialTaskId !== initial.taskId || !Array.isArray(history.rounds) ||
    (history.rounds.length > 0 && initial.records.length !== questions.length && !legacyCompleted)) invalid()
  const previous: ReviewHistory = { ...history, rounds: [] }
  const taskIds = new Set([initial.taskId])
  let revision = 0
  for (const round of history.rounds) {
    if (!round || !Array.isArray(round.wordIds) || !round.snapshot || activeRound(previous)) invalid()
    const expected = reviewWords(initial, previous).filter(w => w.needsReview).map(w => w.wordId)
    if (!expected.length || JSON.stringify(expected) !== JSON.stringify(round.wordIds)) invalid()
    const snapshot = validateSnapshot(round.snapshot, initial.dictionaryVersion, roundQuestions(round, questions))
    if (!snapshot) invalid()
    if (taskIds.has(round.snapshot.taskId)) invalid()
    taskIds.add(round.snapshot.taskId)
    revision += 1 + round.snapshot.records.length
    previous.rounds.push({ wordIds: [...round.wordIds], snapshot: snapshot! })
  }
  if (history.revision !== revision) invalid()
  return previous
}
export async function loadValidatedReviewHistory(storage: RevisionStorage<ReviewHistory>, initial: ScreeningSnapshot, questions: ScreeningQuestion[]) {
  const source = await storage.load()
  const history = validateReviewHistory(source, initial, questions)
  if (source !== undefined && source !== null && JSON.stringify(source) !== JSON.stringify(history)) {
    if (!storage.migrate) throw new Error('当前存储无法安全迁移复筛记录。原存档已保留，未覆盖。')
    await storage.migrate(source as ReviewHistory, history)
  }
  return history
}

export async function beginReview(initial: ScreeningSnapshot, history: ReviewHistory, questions: ScreeningQuestion[], storage: RevisionStorage<ReviewHistory>) {
  if (initial.records.length !== questions.length) throw new Error('请先完成初筛，再开始错词复筛。')
  if (activeRound(history)) return history
  const wordIds = reviewWords(initial, history).filter(w => w.needsReview).map(w => w.wordId)
  if (!wordIds.length) throw new Error('目前没有待复筛的单词。')
  const snapshot: ScreeningSnapshot = {
    schemaVersion: 1, dictionaryVersion: initial.dictionaryVersion,
    questionSignature: questionSignature(questions.filter(q => wordIds.includes(q.wordId))),
    taskId: crypto.randomUUID(), revision: 0, records: [],
  }
  const next: ReviewHistory = JSON.parse(JSON.stringify({ ...history, revision: history.revision + 1, rounds: [...history.rounds, { wordIds, snapshot }] }))
  await storage.save(next, history.revision)
  return next
}

/** The answer and latest review status share one history transaction. */
export function reviewSessionStorage(history: ReviewHistory, storage: RevisionStorage<ReviewHistory>, onSaved: (next: ReviewHistory) => void): ScreeningStorage {
  let current = JSON.parse(JSON.stringify(history)) as ReviewHistory
  const taskId = current.rounds.at(-1)!.snapshot.taskId
  return {
    async load() { return structuredClone(current.rounds.at(-1)!.snapshot) },
    async save(snapshot, expectedRevision) {
      const last = current.rounds.at(-1)!
      if (last.snapshot.taskId !== taskId || snapshot.taskId !== taskId || last.snapshot.revision !== expectedRevision) throw new StorageConflict()
      const next = structuredClone(current)
      next.revision++
      next.rounds[next.rounds.length - 1]!.snapshot = snapshot
      await storage.save(next, current.revision)
      current = next
      onSaved(next)
    },
  }
}
