<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions, type ScreeningQuestion } from '../domain/questions.ts'
import { createIndexedDBStorage, validateSnapshot, type ScreeningSnapshot, type ScreeningStorage, type RevisionStorage } from '../domain/screeningStorage.ts'
import { activeRound, beginReview, createReviewStorage, reviewSessionStorage, reviewWords, roundQuestions, validateReviewHistory, type ReviewHistory } from '../domain/review.ts'
import { backupFileName, createMemorizationCsv, csvFileName, historicalWrongWords, readLearningBackup, restoreLearningBackup, validateLearningBackup } from '../domain/studyTools.ts'
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
const restoreInput = ref<HTMLInputElement | null>(null)
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
    initial.value = validateSnapshot(await createIndexedDBStorage().load(), props.dictionaryVersion, questions.value)
    disk = createReviewStorage()
    history.value = initial.value ? validateReviewHistory(await disk.load(), initial.value, questions.value) : null
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
function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
async function exportCsv() {
  try {
    const backup = validateLearningBackup(await readLearningBackup(undefined, props.dictionaryVersion), props.dictionaryVersion, questions.value)
    const list = historicalWrongWords(backup)
    if (!list.length) { toolMessage.value = '暂无历史错词可导出。'; return }
    download(createMemorizationCsv(list), csvFileName(), 'text/csv;charset=utf-8')
    toolMessage.value = `已导出 ${list.length} 个历史错词。`
  } catch (cause) { toolMessage.value = cause instanceof Error ? cause.message : '导出失败，请重试。' }
}
async function backup() {
  try {
    const archive = await readLearningBackup(undefined, props.dictionaryVersion)
    const checked = validateLearningBackup(archive, props.dictionaryVersion, questions.value)
    download(JSON.stringify(checked, null, 2), backupFileName(), 'application/json')
    toolMessage.value = '学习记录备份已下载。'
  } catch (cause) { toolMessage.value = cause instanceof Error ? cause.message : '备份失败，请重试。' }
}
async function restore(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 1_000_000) { toolMessage.value = '备份文件过大，未恢复。'; input.value = ''; return }
  try {
    const checked = validateLearningBackup(JSON.parse(await file.text()), props.dictionaryVersion, questions.value)
    const expected = await readLearningBackup(undefined, props.dictionaryVersion)
    if (!window.confirm('恢复备份会覆盖当前浏览器中的学习进度和复筛记录。确定恢复吗？')) return
    await restoreLearningBackup(checked, undefined, expected)
    window.location.reload()
  } catch (cause) { toolMessage.value = cause instanceof Error ? cause.message : '备份文件无法恢复。' }
  finally { input.value = '' }
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
        <div class="tool-actions"><button class="secondary" :disabled="!words.length" @click="exportCsv">导出 Excel CSV</button><a class="secondary" :class="{ disabled: !words.length }" href="#print" :aria-disabled="!words.length">打印背诵表</a><button class="secondary" @click="backup">备份学习记录</button><button class="secondary" @click="restoreInput?.click()">恢复备份</button><input ref="restoreInput" class="sr-only" type="file" accept="application/json,.json" aria-label="选择学习记录备份文件" @change="restore" /></div>
        <p v-if="toolMessage" class="tool-message" role="status">{{ toolMessage }}</p>
        <p class="tool-note">CSV 可直接用 Excel 打开；恢复备份会覆盖当前浏览器里的进度，恢复前会再次确认。</p>
      </section>
      <p class="preview-footnote">复筛进度自动保存在本机。备份文件请放在自己能找到的位置。</p>
    </template>
  </section>
</template>
