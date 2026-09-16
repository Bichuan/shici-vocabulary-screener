<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions, type ScreeningQuestion } from '../domain/questions.ts'
import { createIndexedDBStorage, loadValidatedSnapshot, type ScreeningSnapshot, type ScreeningStorage, type RevisionStorage } from '../domain/screeningStorage.ts'
import { activeRound, beginReview, createReviewStorage, loadValidatedReviewHistory, reviewSessionStorage, reviewWords, roundQuestions, type ReviewHistory } from '../domain/review.ts'
import { backupFileName, createMemorizationCsv, csvFileName, historicalWrongWords, readLearningBackup, restoreLearningBackup, validateLearningBackup, type LearningBackup } from '../domain/studyTools.ts'
import { shareOrDownloadFile, type FileTransferResult } from '../domain/fileTransfer.ts'
import ScreeningSession from './ScreeningSession.vue'

const props = defineProps<{ words: VocabularyWord[]; dictionaryVersion: string; active: boolean }>()
const initial = ref<ScreeningSnapshot | null>(null)
const history = ref<ReviewHistory | null>(null)
const questions = shallowRef<ScreeningQuestion[]>([])
const session = shallowRef<{ id: string; questions: ScreeningQuestion[]; storage: ScreeningStorage } | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const filter = ref<'pending' | 'history'>('pending')
const toolMessage = ref('')
const toolBusy = ref(false)
const restoreInput = ref<HTMLInputElement | null>(null)
const MAX_BACKUP_FILE_SIZE = 10_000_000
interface RestorePreview {
  fileName: string
  backup: LearningBackup
  expected: LearningBackup
  answeredCount: number
  wrongCount: number
}
const restorePreview = shallowRef<RestorePreview | null>(null)
let disk: RevisionStorage<ReviewHistory>
const words = computed(() => initial.value && history.value ? reviewWords(initial.value, history.value) : [])
const pendingWords = computed(() => words.value.filter(w => w.needsReview))
const shownWords = computed(() => filter.value === 'pending' ? pendingWords.value : words.value)
const unfinished = computed(() => history.value ? activeRound(history.value) : null)
const initialComplete = computed(() => !!initial.value && initial.value.records.length === questions.value.length)

async function load() {
  if (session.value || loading.value) return
  loading.value = true; error.value = ''
  try {
    questions.value = buildSampleQuestions(props.words)
    initial.value = await loadValidatedSnapshot(createIndexedDBStorage(), props.dictionaryVersion, questions.value)
    disk = createReviewStorage()
    history.value = initial.value ? await loadValidatedReviewHistory(disk, initial.value, questions.value) : null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取错词存档，请重试。' }
  finally {
    loading.value = false
    if (location.hash === '#review-tools') {
      await nextTick()
      document.getElementById('review-tools')?.scrollIntoView({ block: 'start' })
    }
  }
}
watch(() => props.active, active => { if (active) void load() }, { immediate: true })
async function start() {
  if (busy.value || !initial.value || !history.value || !initialComplete.value) return
  busy.value = true; error.value = ''
  try {
    const next = await beginReview(initial.value, history.value, questions.value, disk)
    history.value = next
    const round = activeRound(next)!
    session.value = {
      id: round.snapshot.taskId, questions: roundQuestions(round, questions.value),
      storage: reviewSessionStorage(next, disk, saved => { history.value = saved }),
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法开始复筛，请重试。' }
  finally { busy.value = false }
}
async function back() { session.value = null; await load() }
function transferMessage(result: FileTransferResult, noun: string) {
  if (result === 'shared') return noun + '已通过系统分享处理，可保存到“文件”或 iCloud Drive。'
  if (result === 'downloaded') return noun + '已下载。'
  return '已取消系统分享，现有学习记录没有改变。'
}
async function exportCsv() {
  if (toolBusy.value) return
  const list = words.value.map(word => ({ spelling: word.spelling, coreMeaning: word.coreMeaning }))
  if (!list.length) { toolMessage.value = '暂无历史错词可导出。'; return }
  toolBusy.value = true; toolMessage.value = ''
  try {
    const result = await shareOrDownloadFile(createMemorizationCsv(list), csvFileName(), 'text/csv;charset=utf-8', '拾词错词背诵表')
    toolMessage.value = transferMessage(result, list.length + ' 个历史错词')
  } catch (cause) { toolMessage.value = cause instanceof Error ? cause.message : '导出失败，请重试。' }
  finally { toolBusy.value = false }
}
async function backup() {
  if (toolBusy.value) return
  toolBusy.value = true; toolMessage.value = ''
  try {
    const archive = validateLearningBackup({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      dictionaryVersion: props.dictionaryVersion,
      initial: initial.value ? JSON.parse(JSON.stringify(initial.value)) : null,
      review: history.value?.revision ? JSON.parse(JSON.stringify(history.value)) : null,
    }, props.dictionaryVersion, questions.value)
    const result = await shareOrDownloadFile(JSON.stringify(archive, null, 2), backupFileName(), 'application/json;charset=utf-8', '拾词完整学习备份')
    toolMessage.value = transferMessage(result, '完整学习备份')
  } catch (cause) { toolMessage.value = cause instanceof Error ? cause.message : '备份失败，请重试。' }
  finally { toolBusy.value = false }
}
async function selectRestore(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  restorePreview.value = null
  toolMessage.value = ''
  if (!file) return
  if (file.size > MAX_BACKUP_FILE_SIZE) { toolMessage.value = '备份文件超过 10 MB，未恢复。'; input.value = ''; return }
  try {
    const checked = validateLearningBackup(JSON.parse(await file.text()), props.dictionaryVersion, questions.value)
    const expected = await readLearningBackup(undefined, props.dictionaryVersion)
    restorePreview.value = {
      fileName: file.name,
      backup: checked,
      expected,
      answeredCount: checked.initial?.records.length ?? 0,
      wrongCount: historicalWrongWords(checked).length,
    }
    toolMessage.value = '备份文件已通过校验，请核对下方内容后确认恢复。'
  } catch (cause) {
    toolMessage.value = cause instanceof Error ? cause.message : '备份文件无法恢复。'
  } finally { input.value = '' }
}
async function confirmRestore() {
  const preview = restorePreview.value
  if (!preview || toolBusy.value) return
  toolBusy.value = true
  try {
    await restoreLearningBackup(preview.backup, undefined, preview.expected)
    restorePreview.value = null
    window.location.reload()
  } catch (cause) {
    restorePreview.value = null
    toolMessage.value = cause instanceof Error ? cause.message : '恢复失败，现有记录未更改。'
  } finally { toolBusy.value = false }
}
function cancelRestore() {
  restorePreview.value = null
  toolMessage.value = '已取消恢复，现有学习记录没有改变。'
}
</script>

<template>
  <ScreeningSession v-if="session" :key="session.id" :words="props.words" :dictionary-version="dictionaryVersion" :active="active" :review-questions="session.questions" :storage="session.storage" :initial-count="initial?.records.length" @back="back" />
  <section v-else class="screening-preview" aria-label="错词与复筛">
    <div class="screening-heading"><div><div class="eyebrow">WORDS TO REVISIT</div><h1>把还没记住的词，再筛一遍。</h1></div></div>
    <p class="preview-note">答对后移出待复筛列表，历史错词始终保留。</p>
    <div v-if="loading" class="message-card" role="status">正在读取错词和复筛进度…</div>
    <div v-else-if="error" class="message-card error" role="alert"><p>{{ error }}</p><button class="secondary" @click="load">重新读取</button></div>
    <template v-else>
      <div class="review-overview"><p>已筛选 <strong>{{ initial?.records.length ?? 0 }}</strong> 词</p><button class="primary" :disabled="busy || !initialComplete || (!unfinished && !pendingWords.length)" @click="start">{{ busy ? '正在准备…' : unfinished ? '继续未完成的复筛' : '开始错词复筛' }}</button></div>
      <p v-if="!initialComplete" class="preview-note">先完成全部 {{ questions.length }} 道初筛题，再开始错词复筛。<a class="text-link" href="#screening">继续初筛 →</a></p>
      <div class="review-filters" role="group" aria-label="错词列表范围"><button class="secondary" :aria-pressed="filter === 'pending'" @click="filter = 'pending'">待复筛（{{ pendingWords.length }}）</button><button class="secondary" :aria-pressed="filter === 'history'" @click="filter = 'history'">历史错词（{{ words.length }}）</button></div>
      <div v-if="shownWords.length" class="table-wrap"><table><thead><tr><th scope="col">英文单词</th><th scope="col">核心词义</th><th scope="col">状态</th></tr></thead><tbody><tr v-for="word in shownWords" :key="word.wordId"><td class="spelling">{{ word.spelling }}</td><td class="meaning">{{ word.coreMeaning }}</td><td class="meaning">{{ word.needsReview ? '待复筛' : '复筛已答对' }}</td></tr></tbody></table></div>
      <div v-else class="message-card"><h2>{{ filter === 'history' ? '暂无历史错词' : '暂无待复筛的词' }}</h2><p class="preview-note">{{ words.length ? '之前的错词已在复筛中答对，可以在历史错词中查看。' : initialComplete ? '已开放的初筛题全部答对。' : '初筛中答错的词会自动出现在这里。' }}</p></div>
      <section id="review-tools" class="study-tools" aria-label="导出、打印和备份">
        <h2>导出、打印与备份</h2><p>导出和打印均使用历史错词；复筛答对的词也会保留，方便重复背诵。</p>
        <div class="tool-actions"><button class="secondary" :disabled="toolBusy || !words.length" @click="exportCsv">导出 Excel CSV</button><a class="secondary" :class="{ disabled: !words.length }" href="#print" :aria-disabled="!words.length">打印背诵表</a><button class="secondary" :disabled="toolBusy" @click="backup">备份学习记录</button><button class="secondary" :disabled="toolBusy" @click="restoreInput?.click()">恢复备份</button><input ref="restoreInput" class="sr-only" type="file" accept="application/json,.json" aria-label="选择学习记录备份文件" @change="selectRestore" /></div>
        <p v-if="toolMessage" class="tool-message" role="status">{{ toolMessage }}</p>
        <section v-if="restorePreview" class="restore-confirmation" aria-label="确认恢复备份">
          <div><span>待恢复文件</span><strong>{{ restorePreview.fileName }}</strong></div>
          <div class="restore-metrics"><p><span>已筛查</span><strong>{{ restorePreview.answeredCount }}</strong> 词</p><p><span>历史错词</span><strong>{{ restorePreview.wrongCount }}</strong> 词</p></div>
          <p>词库版本：<code>{{ restorePreview.backup.dictionaryVersion }}</code></p>
          <p>确认后会覆盖这个应用当前的初筛与复筛记录。</p>
          <div class="restore-actions"><button class="primary" :disabled="toolBusy" @click="confirmRestore">确认恢复</button><button class="secondary" :disabled="toolBusy" @click="cancelRestore">取消</button></div>
        </section>
        <p class="tool-note">iPhone 会优先打开系统分享面板，可保存到“文件”或 iCloud Drive；不支持分享文件时会直接下载。恢复前会校验文件和词库版本。</p>
      </section>
      <p class="preview-footnote">复筛进度自动保存在本机。备份文件请放在自己能找到的位置。</p>
    </template>
  </section>
</template>
