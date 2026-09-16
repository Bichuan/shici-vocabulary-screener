import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { AnswerRecord } from './types.ts'
import { shuffleOptions, type ScreeningQuestion } from './questions.ts'
import { createIndexedDBStorage, loadValidatedSnapshot, questionSignature, StorageConflict, type ScreeningSnapshot, type ScreeningStorage } from './screeningStorage.ts'

export interface SubmittedAnswer extends AnswerRecord {
  spelling: string
  coreMeaning: string
  selectedMeaning: string
}

export function useScreening(questions: Ref<ScreeningQuestion[]>, dictionaryVersion: () => string, active: () => boolean, storage?: ScreeningStorage) {
  const phase = ref<'loading' | 'ready' | 'saving' | 'feedback' | 'completed' | 'error'>('loading')
  const records = ref<SubmittedAnswer[]>([])
  const currentWordId = ref<string | null>(null)
  const storageError = ref('')
  const conflict = ref(false)
  const pending = ref<SubmittedAnswer | null>(null)
  let taskId: string = crypto.randomUUID()
  let revision = 0
  let disposed = false
  let repository = storage
  const question = computed(() => questions.value.find(item => item.wordId === currentWordId.value))
  const options = computed(() => shuffleOptions(question.value?.options ?? []))
  const latest = computed(() => records.value.at(-1))
  const wrongWords = computed(() => records.value.filter(record => record.result === 'wrong'))
  let timer: ReturnType<typeof setTimeout> | undefined
  function stopTimer() { clearTimeout(timer); timer = undefined }
  const signature = questionSignature(questions.value)
  const version = dictionaryVersion()
  function nextUnanswered() {
    const answered = new Set(records.value.map(record => record.wordId))
    return questions.value.find(item => !answered.has(item.wordId))
  }

  async function restore() {
    if (pending.value || disposed || phase.value === 'saving') return
    phase.value = 'loading'
    storageError.value = ''
    try {
      repository ??= createIndexedDBStorage()
      const snapshot = await loadValidatedSnapshot(repository, version, questions.value)
      if (disposed) return
      if (snapshot) { records.value = snapshot.records; taskId = snapshot.taskId; revision = snapshot.revision }
      // An answer committed during feedback is already complete on the next visit.
      currentWordId.value = nextUnanswered()?.wordId ?? null
      phase.value = currentWordId.value ? 'ready' : 'completed'
    } catch (error) {
      if (disposed) return
      storageError.value = error instanceof Error ? error.message : '无法读取本地存档，请重试。'
      phase.value = 'error'
    }
  }

  async function savePending() {
    if (!pending.value || phase.value === 'saving' || conflict.value || disposed) return false
    phase.value = 'saving'
    storageError.value = ''
    // IndexedDB cannot clone Vue proxies.
    const snapshot: ScreeningSnapshot = JSON.parse(JSON.stringify({
      schemaVersion: 1, dictionaryVersion: version, questionSignature: signature,
      taskId, revision: revision + 1, records: [...records.value, pending.value],
    }))
    try {
      await repository!.save(snapshot, revision)
      if (disposed) return true
      records.value = snapshot.records
      revision = snapshot.revision
      pending.value = null
      phase.value = 'feedback'
      return true
    } catch (error) {
      if (disposed) return false
      conflict.value = error instanceof StorageConflict
      storageError.value = conflict.value ? (error as Error).message : '这次选择尚未保存，请重试保存。成功前不会进入下一题。'
      phase.value = 'error'
      return false
    }
  }

  async function submit(questionId: string, optionId: string) {
    const current = question.value
    if (!active() || phase.value !== 'ready' || !current || current.id !== questionId) return false
    const option = current.options.find(item => item.id === optionId)
    if (!option || records.value.some(record => record.wordId === current.wordId)) return false
    pending.value = {
      id: crypto.randomUUID(), taskId, wordId: current.wordId,
      dictionaryVersion: version, questionVersion: current.version,
      selectedOptionId: option.id, result: option.id === current.correctOptionId ? 'correct' : 'wrong',
      answeredAt: new Date().toISOString(), spelling: current.spelling,
      coreMeaning: current.coreMeaning, selectedMeaning: option.text,
    }
    return savePending()
  }

  watch([phase, active], () => {
    stopTimer()
    if (phase.value !== 'feedback' || !active()) return
    timer = setTimeout(() => {
      currentWordId.value = nextUnanswered()?.wordId ?? null
      phase.value = currentWordId.value ? 'ready' : 'completed'
    }, 1000)
  }, { flush: 'sync' })
  watch([questions, dictionaryVersion], () => {
    stopTimer()
    phase.value = 'error'
    conflict.value = true
    storageError.value = '词库已更新，请刷新页面核对存档版本后继续。'
  }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; stopTimer() })
  const ready = restore()
  return { question, options, phase, records, latest, wrongWords, submit, ready, restore, savePending, storageError, pending, conflict }
}
