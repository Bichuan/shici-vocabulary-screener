import type { ScreeningQuestion } from './questions.ts'
import { reviewWords, validateReviewHistory, type ReviewHistory } from './review.ts'
import { StorageConflict, validateSnapshot, type ScreeningSnapshot } from './screeningStorage.ts'
import { dictionaryLabel, learningKeys, type LearningDictionaryId } from './learningNamespace.ts'

const databaseName = 'shici-learning'
const storeName = 'sessions'

export interface LearningBackup {
  schemaVersion: 1
  createdAt: string
  /** Legacy NETEM exports omit this field; all new exports include it. */
  dictionaryId?: LearningDictionaryId
  dictionaryVersion: string
  initial: ScreeningSnapshot | null
  review: ReviewHistory | null
}
export interface MemorizationWord { spelling: string; coreMeaning: string }
export type MemorizationScope = 'history' | 'pending'

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

export async function readLearningBackup(factory: IDBFactory = indexedDB, dictionaryVersion = '', dictionaryId: LearningDictionaryId = 'netem-2024'): Promise<LearningBackup> {
  const keys = learningKeys(dictionaryId)
  const db = await openDatabase(factory)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const initial = store.get(keys.initial)
    const review = store.get(keys.review)
    transaction.oncomplete = () => {
      db.close()
      resolve({ schemaVersion: 1, createdAt: new Date().toISOString(), dictionaryId, dictionaryVersion: initial.result?.dictionaryVersion ?? dictionaryVersion, initial: initial.result ?? null, review: review.result ?? null })
    }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('读取学习记录失败。')) }
  })
}

export async function restoreLearningBackup(backup: LearningBackup, factory: IDBFactory = indexedDB, expected?: LearningBackup, dictionaryId: LearningDictionaryId = 'netem-2024'): Promise<void> {
  const keys = learningKeys(dictionaryId)
  if ((backup.dictionaryId ?? 'netem-2024') !== dictionaryId || (expected && (expected.dictionaryId ?? 'netem-2024') !== dictionaryId)) {
    throw new Error('备份属于其他词库，现有学习记录未更改。')
  }
  const db = await openDatabase(factory)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const initial = store.get(keys.initial)
    const review = store.get(keys.review)
    let conflict = false
    review.onsuccess = () => {
      if (expected && (JSON.stringify(initial.result ?? null) !== JSON.stringify(expected.initial) || JSON.stringify(review.result ?? null) !== JSON.stringify(expected.review))) {
        conflict = true; transaction.abort(); return
      }
      // Retain the previous state and invalidate repositories in already-open tabs.
      store.put({ initial: initial.result ?? null, review: review.result ?? null }, keys.beforeRestore)
      store.put(crypto.randomUUID(), keys.generation)
      if (backup.initial) store.put(backup.initial, keys.initial); else store.delete(keys.initial)
      if (backup.review) store.put(backup.review, keys.review); else store.delete(keys.review)
    }
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(conflict ? new StorageConflict() : transaction.error ?? new Error('恢复备份失败，现有记录未更改。')) }
  })
}

export function validateLearningBackup(value: unknown, dictionaryVersion: string, questions: ScreeningQuestion[], dictionaryId: LearningDictionaryId = 'netem-2024'): LearningBackup {
  learningKeys(dictionaryId)
  const backup = value as LearningBackup
  const invalid = () => { throw new Error('备份文件格式不正确，现有学习记录未更改。') }
  if (backup && typeof backup === 'object' && (backup.dictionaryId ?? 'netem-2024') !== dictionaryId) {
    throw new Error('备份属于其他词库，现有学习记录未更改。')
  }
  if (!backup || typeof backup !== 'object' || backup.schemaVersion !== 1 || typeof backup.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(backup.createdAt)) || backup.dictionaryVersion !== dictionaryVersion ||
    !('initial' in backup) || !('review' in backup)) invalid()
  const initial = validateSnapshot(backup.initial, dictionaryVersion, questions)
  if (!initial && backup.review !== null) invalid()
  // Missing review history must stay null; an empty history otherwise incorrectly
  // implies that initial screening has been completed on the next validation.
  const review = initial && backup.review !== null ? validateReviewHistory(backup.review, initial, questions) : null
  return { schemaVersion: 1, createdAt: backup.createdAt, dictionaryId, dictionaryVersion, initial, review }
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
export function createMemorizationCsv(words: readonly MemorizationWord[]): string {
  const lines = [['序号', '英文单词', '正确核心义'], ...words.map((word, index) => [String(index + 1), word.spelling, word.coreMeaning])]
  return `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
export function backupFileName(date = new Date(), dictionaryId?: LearningDictionaryId) {
  return `拾词-${dictionaryId ? dictionaryLabel(dictionaryId) + '-' : ''}学习备份-${date.toISOString().slice(0, 10)}.json`
}
export function screeningBackupFileName(answeredCount: number, date = new Date(), dictionaryId?: LearningDictionaryId) {
  const stamp = date.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  return `拾词-${dictionaryId ? dictionaryLabel(dictionaryId) + '-' : ''}筛查备份-${answeredCount}词-${stamp}.json`
}
export function csvFileName(date = new Date(), dictionaryId?: LearningDictionaryId, scope: MemorizationScope = 'history') {
  return `拾词-${dictionaryId ? dictionaryLabel(dictionaryId) + '-' : ''}${scope === 'pending' ? '当前仍不会' : '错词背诵'}-${date.toISOString().slice(0, 10)}.csv`
}
export function memorizationWords(backup: LearningBackup, scope: MemorizationScope): MemorizationWord[] {
  if (!backup.initial) return []
  const review = backup.review ?? { schemaVersion: 1 as const, initialTaskId: backup.initial.taskId, revision: 0, rounds: [] }
  const words = reviewWords(backup.initial, review)
  return (scope === 'pending' ? words.filter(word => word.needsReview) : words)
    .map(word => ({ spelling: word.spelling, coreMeaning: word.coreMeaning }))
}
export function historicalWrongWords(backup: LearningBackup): MemorizationWord[] {
  return memorizationWords(backup, 'history')
}
