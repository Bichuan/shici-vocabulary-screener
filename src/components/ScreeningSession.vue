<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions, type ScreeningQuestion } from '../domain/questions.ts'
import { useScreening } from '../domain/useScreening.ts'
import { questionSignature, type ScreeningSnapshot, type ScreeningStorage } from '../domain/screeningStorage.ts'
import { readLearningBackup, restoreLearningBackup, screeningBackupFileName, type LearningBackup } from '../domain/studyTools.ts'
import { shareOrDownloadFile } from '../domain/fileTransfer.ts'

const props = defineProps<{ words: VocabularyWord[]; dictionaryVersion: string; active: boolean; reviewQuestions?: ScreeningQuestion[]; storage?: ScreeningStorage; initialCount?: number }>()
const emit = defineEmits<{ back: [] }>()
const isReview = computed(() => !!props.reviewQuestions)
const questions = ref<ScreeningQuestion[]>([])
const error = ref('')
const actionMessage = ref('')
const actionBusy = ref(false)
const visible = ref(!document.hidden)
const wordHeading = ref<HTMLElement | null>(null)
function visibilityChanged() { visible.value = !document.hidden }
onMounted(() => document.addEventListener('visibilitychange', visibilityChanged))
onUnmounted(() => document.removeEventListener('visibilitychange', visibilityChanged))
watch(() => props.words, words => {
  try { questions.value = props.reviewQuestions ?? buildSampleQuestions(words); error.value = '' }
  catch { questions.value = []; error.value = '题目与当前词库不匹配，请重新导入词库后刷新。' }
}, { immediate: true })
const { question, options, phase, records, latest, wrongWords, submit, storageError, pending, conflict, restore, savePending } = useScreening(
  questions, () => props.dictionaryVersion, () => props.active && visible.value, props.storage,
)
const feedback = computed(() => phase.value === 'feedback')
const saveStatus = computed(() => phase.value === 'loading' ? '正在读取存档…' : phase.value === 'saving' ? '正在保存…' : phase.value === 'error' ? '存档需要处理' : records.value.length ? '进度与错词已保存在本机' : '答题后自动保存到本机')
const actionDisabled = computed(() => actionBusy.value || !!pending.value || ['loading', 'saving'].includes(phase.value))
async function backupScreening() {
  if (actionDisabled.value || !records.value.length) return
  actionBusy.value = true
  actionMessage.value = ''
  try {
    const count = records.value.length
    const first = records.value[0]!
    const initial: ScreeningSnapshot = JSON.parse(JSON.stringify({
      schemaVersion: 1,
      dictionaryVersion: props.dictionaryVersion,
      questionSignature: questionSignature(questions.value),
      taskId: first.taskId,
      revision: count,
      records: records.value,
    }))
    const backup: LearningBackup = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      dictionaryVersion: props.dictionaryVersion,
      initial,
      review: null,
    }
    const result = await shareOrDownloadFile(JSON.stringify(backup, null, 2), screeningBackupFileName(count), 'application/json;charset=utf-8', '拾词当前筛查备份')
    const saved = result === 'shared' ? '已通过系统分享处理' : result === 'downloaded' ? '已下载' : '已取消分享'
    actionMessage.value = saved + ' ' + count + ' 个已筛词。可以继续筛选，或重置后开始新一轮。'
  } catch (cause) {
    actionMessage.value = cause instanceof Error ? cause.message : '筛查记录备份失败，请重试。'
  } finally {
    actionBusy.value = false
  }
}
async function resetScreening() {
  if (actionDisabled.value || !records.value.length) return
  actionBusy.value = true
  actionMessage.value = ''
  try {
    const current = await readLearningBackup(indexedDB, props.dictionaryVersion)
    const count = current.initial?.records.length ?? 0
    if (!count) { actionMessage.value = '当前没有需要重置的筛查记录。'; return }
    if (!window.confirm(`重置会清空当前已筛选的 ${count} 个词及复筛记录。需要保留时请先备份。确定重新开始吗？`)) return
    const empty: LearningBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), dictionaryVersion: props.dictionaryVersion, initial: null, review: null }
    await restoreLearningBackup(empty, indexedDB, current)
    window.location.reload()
  } catch (cause) {
    actionMessage.value = cause instanceof Error ? cause.message : '重置失败，当前记录没有改变。'
  } finally {
    actionBusy.value = false
  }
}
function protectUnsaved(event: BeforeUnloadEvent) {
  if (!pending.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', protectUnsaved))
onUnmounted(() => window.removeEventListener('beforeunload', protectUnsaved))
watch(question, async () => {
  await nextTick()
  if (props.active && visible.value) wordHeading.value?.focus({ preventScroll: true })
})
</script>

<template>
  <section class="screening-preview screening-session" aria-label="单词筛查">
    <div class="screening-heading"><div><div class="eyebrow">ONE WORD AT A TIME</div><h1>这个词，是什么意思？</h1></div><span class="pill">{{ isReview ? '错词复筛' : `${questions.length} 词完整版` }}</span></div>
    <p class="preview-note">{{ isReview ? '只筛查之前答错的词，答对后移出待复筛列表。' : '全部选项均取自原始词表，词序按首字母交错随机。再次打开即可继续上次进度。' }}</p>
    <p class="save-status" role="status" aria-live="polite">{{ saveStatus }}</p>
    <p v-if="error" class="message-card error" role="alert">{{ error }}</p>
    <template v-else>
      <div v-if="phase === 'loading'" class="message-card" role="status">正在恢复学习进度…</div>
      <div v-if="storageError" class="message-card error" role="alert"><p>{{ storageError }}</p><p v-if="pending">尚未保存的选择：{{ pending.spelling }} → {{ pending.selectedMeaning }}</p><button v-if="!conflict" class="secondary" @click="pending ? savePending() : restore()">{{ pending ? '重试保存' : '重新读取存档' }}</button></div>
      <div class="screening-progress"><span>已筛选 <strong>{{ isReview ? initialCount : records.length }}</strong>{{ isReview ? '' : ` / ${questions.length}` }} 词</span><progress v-if="!isReview" :value="records.length" :max="questions.length || 1" aria-label="已筛选词汇进度"></progress><button v-if="isReview" class="secondary" :disabled="!!pending || phase === 'loading'" @click="emit('back')">返回错词列表</button></div>
      <div v-if="!isReview" id="screening-tools" class="screening-actions" aria-label="筛查记录操作">
        <button class="secondary" :disabled="actionDisabled || !records.length" @click="backupScreening">{{ actionBusy ? '正在处理…' : '备份当前筛查' }}</button>
        <button class="secondary danger-action" :disabled="actionDisabled || !records.length" @click="resetScreening">重置筛查</button>
        <span>备份后可以继续筛选，也可以重置并重新开始。</span>
      </div>
      <p v-if="actionMessage" class="screening-action-message" role="status" aria-live="polite">{{ actionMessage }}</p>
      <div v-if="question && phase !== 'loading'" class="question-card">
        <div class="question-meta"><span>选择一个核心词义</span><span>选择后自动切题</span></div>
        <div class="target-word"><h2 ref="wordHeading" tabindex="-1">{{ question.spelling }}</h2></div>
        <div class="answer-options" role="group" :aria-label="`${question.spelling} 的核心中文词义`" :key="question.id">
          <button v-for="(option, optionIndex) in options" :key="option.id" type="button" class="answer-option"
            :disabled="phase !== 'ready'" :class="{ selected: pending?.selectedOptionId === option.id, 'is-correct': feedback && option.id === question.correctOptionId, 'is-wrong': feedback && option.id === latest?.selectedOptionId && latest?.result === 'wrong' }"
            @click="submit(question.id, option.id)">
            <span class="option-letter" aria-hidden="true">{{ 'ABCDEFGH'[optionIndex] }}</span><span>{{ option.text }}</span>
            <span v-if="feedback && option.id === question.correctOptionId" class="option-result">✓ 正确</span>
            <span v-else-if="feedback && option.id === latest?.selectedOptionId" class="option-result">× 所选</span>
          </button>
        </div>
        <div class="answer-feedback" role="status" aria-live="polite" aria-atomic="true"><template v-if="feedback"><strong>{{ question.spelling }} → {{ question.coreMeaning }}</strong><span>{{ latest?.result === 'wrong' ? '错词已保存 · ' : '' }}1 秒后自动继续</span></template><span v-else>{{ phase === 'saving' ? '正在保存这次选择…' : phase === 'error' ? '请先处理上方存档提示' : '点击选项即可作答' }}</span></div>
      </div>
      <div v-else-if="phase === 'completed'" class="message-card completion-card" role="status"><h2 ref="wordHeading" tabindex="-1">{{ isReview ? '这次复筛已完成' : '全部词汇已筛选完成' }}</h2><p>{{ isReview ? '结果已保存。仍未答对的词可以再次复筛，历史错词会继续保留。' : `本次已完成全部 ${questions.length} 个词。` }}</p><button v-if="isReview" class="secondary" @click="emit('back')">查看复筛结果</button><a v-else class="secondary" href="#review">查看错词与复筛</a></div>
      <details v-if="!isReview" class="wrong-word-list"><summary>查看初筛记录的错词</summary><p class="preview-note">只保留单词和正确核心义，供后续复筛、导出及打印背诵。</p><a class="secondary" href="#review">前往错词与复筛 →</a><div v-if="wrongWords.length" class="table-wrap"><table><thead><tr><th scope="col">英文单词</th><th scope="col">正确核心义</th></tr></thead><tbody><tr v-for="word in wrongWords" :key="word.wordId"><td class="spelling">{{ word.spelling }}</td><td class="meaning">{{ word.coreMeaning }}</td></tr></tbody></table></div><p v-else class="preview-note">暂无错词记录。</p></details>
      <p class="preview-footnote">记录只保存在当前设备的这个应用中；清除网站数据会删除存档，隐私模式不适合长期保存。</p>
    </template>
  </section>
</template>
