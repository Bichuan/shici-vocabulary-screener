<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions } from '../domain/questions.ts'
import { historicalWrongWords, readLearningBackup, validateLearningBackup } from '../domain/studyTools.ts'

const props = defineProps<{ words: VocabularyWord[]; dictionaryVersion: string }>()
const loading = ref(true)
const error = ref('')
const wordList = ref<{ spelling: string; coreMeaning: string }[]>([])
const count = computed(() => wordList.value.length)
type MemorizationWord = { spelling: string; coreMeaning: string }

function estimatedRowHeight(word: MemorizationWord) {
  const lines = Math.max(Math.ceil(word.spelling.length / 15), Math.ceil(word.coreMeaning.length / 7))
  return 8 + (lines - 1) * 4.5
}

function splitColumns(items: MemorizationWord[]): MemorizationWord[][] {
  if (items.length <= 3) return Array.from({ length: 3 }, (_, index) => items.slice(index, index + 1))
  const heights = items.map(estimatedRowHeight)
  const columns: MemorizationWord[][] = [[], [], []]
  let next = 0
  let remainingHeight = heights.reduce((sum, height) => sum + height, 0)
  for (let column = 0; column < 2; column++) {
    const target = remainingHeight / (3 - column)
    const last = items.length - (2 - column)
    let used = 0
    while (next < last && (!columns[column]!.length || used + heights[next]! <= target)) {
      columns[column]!.push(items[next]!)
      used += heights[next]!
      next++
    }
    remainingHeight -= used
  }
  columns[2] = items.slice(next)
  return columns
}

const pages = computed(() => {
  const result: MemorizationWord[][][] = []
  let items: MemorizationWord[] = []
  let height = 0
  for (const word of wordList.value) {
    const rowHeight = estimatedRowHeight(word)
    if (items.length && height + rowHeight > 570) {
      result.push(splitColumns(items))
      items = []
      height = 0
    }
    items.push(word)
    height += rowHeight
  }
  if (items.length) result.push(splitColumns(items))
  return result
})
function back() { window.location.hash = '#review' }
function printSheet() { window.print() }
onMounted(async () => {
  try {
    const backup = validateLearningBackup(await readLearningBackup(undefined, props.dictionaryVersion), props.dictionaryVersion, buildSampleQuestions(props.words))
    wordList.value = historicalWrongWords(backup)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取错词记录。' }
  finally { loading.value = false }
})
</script>

<template>
  <section class="print-sheet" aria-label="错词背诵打印表">
    <div class="print-head no-print"><div><h1>错词背诵表</h1><p>共 {{ count }} 词 · A4 三栏，先向下读，再从左到右。若打印预览仍显示网址和日期，请在打印设置中关闭“页眉和页脚”。</p></div><div class="print-actions"><button class="secondary" @click="back">返回错词列表</button><button class="primary" :disabled="loading || !!error || !count" @click="printSheet">打印 / 保存为 PDF</button></div></div>
    <div v-if="loading" class="message-card" role="status">正在整理打印表…</div>
    <div v-else-if="error" class="message-card error" role="alert">{{ error }}</div>
    <div v-else-if="!count" class="message-card"><h2>暂无历史错词</h2><p class="preview-note">初筛答错的单词会自动出现在这里。</p></div>
    <div v-else class="memorization-pages">
      <article v-for="(columns, pageIndex) in pages" :key="pageIndex" class="memorization-page" :aria-label="`第 ${pageIndex + 1} 页`">
        <div class="memorization-columns">
          <table v-for="(column, columnIndex) in columns" :key="columnIndex" class="print-table" aria-label="单词与释义"><colgroup><col class="memorization-word" /><col /></colgroup><tbody><tr v-for="word in column" :key="word.spelling"><td>{{ word.spelling }}</td><td>{{ word.coreMeaning }}</td></tr></tbody></table>
        </div>
      </article>
    </div>
  </section>
</template>
