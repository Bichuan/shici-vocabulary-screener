import type { ScreeningQuestion } from './questions.ts'
import { reviewWords, validateReviewHistory, type ReviewHistory } from './review.ts'
import { StorageConflict, validateSnapshot, type ScreeningSnapshot } from './screeningStorage.ts'

const databaseName = 'shici-learning'
const storeName = 'sessions'
const initialKey = 'initial-screening'
const reviewKey = 'review-history'

export interface LearningBackup {
  schemaVersion: 1
  createdAt: string
  dictionaryVersion: string
  initial: ScreeningSnapshot | null
  review: ReviewHistory | null
}
export interface MemorizationWord { spelling: string; coreMeaning: string }

function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }
    let abandoned = false
    request.onblocked = () => { abandoned = true; reject(new Error('其他页面正在占用本地存储，请关闭后重试。')) }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地学习记录。'))
    request.onsuccess = () => { if (abandoned) { request.result.close(); return }; request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}

export async function readLearningBackup(factory: IDBFactory = indexedDB, dictionaryVersion = ''): Promise<LearningBackup> {
  const db = await openDatabase(factory)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const initial = store.get(initialKey)
    const review = store.get(reviewKey)
    transaction.oncomplete = () => {
      db.close()
      resolve({ schemaVersion: 1, createdAt: new Date().toISOString(), dictionaryVersion: initial.result?.dictionaryVersion ?? dictionaryVersion, initial: initial.result ?? null, review: review.result ?? null })
    }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('读取学习记录失败。')) }
  })
}

export async function restoreLearningBackup(backup: LearningBackup, factory: IDBFactory = indexedDB, expected?: LearningBackup): Promise<void> {
  const db = await openDatabase(factory)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const initial = store.get(initialKey)
    const review = store.get(reviewKey)
    let conflict = false
    review.onsuccess = () => {
      if (expected && (JSON.stringify(initial.result ?? null) !== JSON.stringify(expected.initial) || JSON.stringify(review.result ?? null) !== JSON.stringify(expected.review))) {
        conflict = true; transaction.abort(); return
      }
      // Retain the previous state and invalidate repositories in already-open tabs.
      store.put({ initial: initial.result ?? null, review: review.result ?? null }, 'before-restore')
      store.put(crypto.randomUUID(), 'storage-generation')
      if (backup.initial) store.put(backup.initial, initialKey); else store.delete(initialKey)
      if (backup.review) store.put(backup.review, reviewKey); else store.delete(reviewKey)
    }
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(conflict ? new StorageConflict() : transaction.error ?? new Error('恢复备份失败，现有记录未更改。')) }
  })
}

export function validateLearningBackup(value: unknown, dictionaryVersion: string, questions: ScreeningQuestion[]): LearningBackup {
  const backup = value as LearningBackup
  const invalid = () => { throw new Error('备份文件格式不正确，现有学习记录未更改。') }
  if (!backup || typeof backup !== 'object' || backup.schemaVersion !== 1 || typeof backup.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(backup.createdAt)) || backup.dictionaryVersion !== dictionaryVersion ||
    !('initial' in backup) || !('review' in backup)) invalid()
  const initial = validateSnapshot(backup.initial, dictionaryVersion, questions)
  if (!initial && backup.review !== null) invalid()
  // Missing review history must stay null; an empty history otherwise incorrectly
  // implies that initial screening has been completed on the next validation.
  const review = initial && backup.review !== null ? validateReviewHistory(backup.review, initial, questions) : null
  return { schemaVersion: 1, createdAt: backup.createdAt, dictionaryVersion, initial, review }
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
export function createMemorizationCsv(words: readonly MemorizationWord[]): string {
  const lines = [['序号', '英文单词', '正确核心义'], ...words.map((word, index) => [String(index + 1), word.spelling, word.coreMeaning])]
  return `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
export function backupFileName(date = new Date()) {
  return `拾词-学习备份-${date.toISOString().slice(0, 10)}.json`
}
export function screeningBackupFileName(answeredCount: number, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  return `拾词-筛查备份-${answeredCount}词-${stamp}.json`
}
export function csvFileName(date = new Date()) {
  return `拾词-错词背诵-${date.toISOString().slice(0, 10)}.csv`
}
export function historicalWrongWords(backup: LearningBackup): MemorizationWord[] {
  if (!backup.initial) return []
  const review = backup.review ?? { schemaVersion: 1 as const, initialTaskId: backup.initial.taskId, revision: 0, rounds: [] }
  return reviewWords(backup.initial, review).map(word => ({ spelling: word.spelling, coreMeaning: word.coreMeaning }))
}
