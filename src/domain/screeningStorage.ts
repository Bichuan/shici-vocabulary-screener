import type { SubmittedAnswer } from './useScreening.ts'
import { LEGACY_SAMPLE_VERSION, PREVIOUS_QUESTION_VERSIONS, type ScreeningQuestion } from './questions.ts'

export interface ScreeningSnapshot {
  schemaVersion: 1
  dictionaryVersion: string
  questionSignature: string
  taskId: string
  revision: number
  records: SubmittedAnswer[]
}
export interface RevisionStorage<T> {
  load(): Promise<unknown>
  save(snapshot: T, expectedRevision: number): Promise<void>
}
export type ScreeningStorage = RevisionStorage<ScreeningSnapshot>
export class StorageConflict extends Error {
  constructor() { super('另一个页面已更新学习进度。请刷新此页面继续，当前选择尚未保存。') }
}
export function questionSignature(questions: ScreeningQuestion[]) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const question of [...questions].sort((a, b) => a.wordId.localeCompare(b.wordId, 'en'))) {
    const value = `${question.id}\u001f${question.version}\u001f${question.wordId}\u001f${question.coreMeaning}\u001f${question.correctOptionId}\u001f${question.options.map(option => `${option.id}\u001e${option.text}`).join('\u001d')}\u001c`
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      first = Math.imul(first ^ code, 0x01000193)
      second = Math.imul(second ^ code, 0x85ebca6b)
    }
  }
  return `questions-v3:${questions.length}:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function isPreviousSnapshot(snapshot: ScreeningSnapshot) {
  return typeof snapshot.questionSignature === 'string' &&
    (snapshot.questionSignature.includes(LEGACY_SAMPLE_VERSION) || snapshot.questionSignature.startsWith('questions-v2:') ||
      (snapshot.questionSignature.startsWith('questions-v3:') && snapshot.records.every(record =>
        PREVIOUS_QUESTION_VERSIONS.includes(record.questionVersion as typeof PREVIOUS_QUESTION_VERSIONS[number]))))
}

function migratePreviousSnapshot(snapshot: ScreeningSnapshot, dictionaryVersion: string, questions: ScreeningQuestion[]): ScreeningSnapshot | null {
  if (!isPreviousSnapshot(snapshot) || snapshot.revision !== snapshot.records.length || snapshot.records.length > questions.length) return null
  const byWordId = new Map(questions.map(question => [question.wordId, question]))
  const ids = new Set<string>()
  const wordIds = new Set<string>()
  const records = snapshot.records.map(record => {
    const question = byWordId.get(record?.wordId)
    if (!question || !record || record.spelling !== question.spelling ||
      record.dictionaryVersion !== dictionaryVersion || ![...PREVIOUS_QUESTION_VERSIONS, question.version].includes(record.questionVersion) ||
      !['correct', 'wrong'].includes(record.result) || typeof record.id !== 'string' || !record.id || ids.has(record.id) ||
      wordIds.has(record.wordId) ||
      record.taskId !== snapshot.taskId || typeof record.answeredAt !== 'string' || !Number.isFinite(Date.parse(record.answeredAt)) ||
      (record.result === 'correct') !== (record.selectedMeaning === record.coreMeaning)) return null
    ids.add(record.id)
    wordIds.add(record.wordId)
    const option = record.result === 'correct'
      ? question.options.find(item => item.id === question.correctOptionId)
      : question.options.find(item => item.id === record.selectedOptionId && item.text === record.selectedMeaning && item.id !== question.correctOptionId)
        ?? question.options.find(item => item.id !== question.correctOptionId)
    if (!option) return null
    return {
      ...record,
      questionVersion: question.version,
      selectedOptionId: option.id,
      spelling: question.spelling,
      coreMeaning: question.coreMeaning,
      selectedMeaning: option.text,
    }
  })
  if (records.some(record => record === null)) return null
  return { ...snapshot, questionSignature: questionSignature(questions), records: records as SubmittedAnswer[] }
}
export function validateSnapshot(value: unknown, dictionaryVersion: string, questions: ScreeningQuestion[]): ScreeningSnapshot | null {
  if (value === undefined || value === null) return null
  let snapshot = value as ScreeningSnapshot
  if (snapshot.schemaVersion !== 1) throw new Error('存档格式无法识别。原存档已保留，未覆盖。')
  if (snapshot.dictionaryVersion !== dictionaryVersion) {
    throw new Error('词库或题目版本与存档不一致。原进度已保留，需要先兼容旧存档后再继续。')
  }
  if (snapshot.questionSignature !== questionSignature(questions)) {
    const migrated = migratePreviousSnapshot(snapshot, dictionaryVersion, questions)
    if (!migrated) throw new Error('词库或题目版本与存档不一致。原进度已保留，需要先兼容旧存档后再继续。')
    snapshot = migrated
  }
  const invalid = () => { throw new Error('存档内容不完整或不一致。原存档已保留，未重新开始。') }
  if (typeof snapshot.taskId !== 'string' || !snapshot.taskId || !Array.isArray(snapshot.records) ||
    snapshot.revision !== snapshot.records.length || snapshot.records.length > questions.length) invalid()
  const ids = new Set<string>()
  const wordIds = new Set<string>()
  const byWordId = new Map(questions.map(question => [question.wordId, question]))
  for (const record of snapshot.records) {
    if (!record || typeof record !== 'object') invalid()
    const q = byWordId.get(record.wordId)!
    if (!q) invalid()
    const option = q.options.find(o => o.id === record.selectedOptionId)
    if (!option || typeof record.id !== 'string' || !record.id || ids.has(record.id) || wordIds.has(record.wordId) || record.taskId !== snapshot.taskId ||
      record.questionVersion !== q.version || record.dictionaryVersion !== dictionaryVersion ||
      record.spelling !== q.spelling || record.coreMeaning !== q.coreMeaning || record.selectedMeaning !== option.text ||
      record.result !== (option.id === q.correctOptionId ? 'correct' : 'wrong') ||
      typeof record.answeredAt !== 'string' || !Number.isFinite(Date.parse(record.answeredAt))) invalid()
    ids.add(record.id)
    wordIds.add(record.wordId)
  }
  return snapshot
}

/** A single transaction commits the answer and progress together. */
export function createRevisionStorage<T extends { revision: number }>(key: string, factory: IDBFactory = indexedDB, databaseName = 'shici-learning', compatible: (previous: T, next: T) => boolean = () => true): RevisionStorage<T> {
  let generation: string | null | undefined
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(databaseName, 1)
      let abandoned = false
      request.onupgradeneeded = () => { request.result.createObjectStore('sessions') }
      request.onblocked = () => { abandoned = true; reject(new Error('本地存储升级被其他页面占用，请关闭其他筛查页面后重试。')) }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
  }
  return {
    async load() {
      const db = await open()
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly')
        const request = tx.objectStore('sessions').get(key)
        const epoch = tx.objectStore('sessions').get('storage-generation')
        tx.oncomplete = () => { generation = epoch.result ?? null; db.close(); resolve(request.result) }
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error('读取存档失败')) }
      })
    },
    async save(snapshot, expectedRevision) {
      const db = await open()
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite')
        const store = tx.objectStore('sessions')
        const request = store.get(key)
        const epoch = store.get('storage-generation')
        let conflict = false
        epoch.onsuccess = () => {
          const previous = request.result as T | undefined
          if ((generation !== undefined && generation !== (epoch.result ?? null)) || (previous?.revision ?? 0) !== expectedRevision ||
            (previous && !compatible(previous, snapshot))) {
            conflict = true; tx.abort(); return
          }
          generation = epoch.result ?? null
          store.put(snapshot, key)
        }
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => { db.close(); reject(conflict ? new StorageConflict() : tx.error ?? new Error('保存失败')) }
      })
    },
  }
}

export function createIndexedDBStorage(factory: IDBFactory = indexedDB, databaseName = 'shici-learning'): ScreeningStorage {
  return createRevisionStorage<ScreeningSnapshot>('initial-screening', factory, databaseName, (a, b) => {
    if (a.taskId !== b.taskId || a.dictionaryVersion !== b.dictionaryVersion) return false
    if (a.questionSignature === b.questionSignature) return true
    return isPreviousSnapshot(a) && b.records.length === a.records.length + 1 && a.records.every((record, index) => {
      const next = b.records[index]
      return next?.id === record.id && next.wordId === record.wordId && next.result === record.result && next.answeredAt === record.answeredAt
    })
  })
}
