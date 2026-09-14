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
const pages = computed(() => {
  return Array.from({ length: Math.ceil(wordList.value.length / 90) }, (_, page) => {
    const items = wordList.value.slice(page * 90, (page + 1) * 90)
    const size = Math.ceil(items.length / 3)
    return Array.from({ length: 3 }, (_, column) => items.slice(column * size, (column + 1) * size))
  })
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
    <div class="print-head no-print"><div><h1>错词背诵表</h1><p>共 {{ count }} 词 · A4 三栏，先向下读，再从左到右</p></div><div class="print-actions"><button class="secondary" @click="back">返回错词列表</button><button class="primary" :disabled="loading || !!error || !count" @click="printSheet">打印 / 保存为 PDF</button></div></div>
    <div v-if="loading" class="message-card" role="status">正在整理打印表…</div>
    <div v-else-if="error" class="message-card error" role="alert">{{ error }}</div>
    <div v-else-if="!count" class="message-card"><h2>暂无历史错词</h2><p class="preview-note">初筛答错的单词会自动出现在这里。</p></div>
    <div v-else class="memorization-pages">
      <article v-for="(columns, pageIndex) in pages" :key="pageIndex" class="memorization-page">
        <header class="memorization-title"><strong>错词背诵表</strong><span>从上到下，再从左到右 · 第 {{ pageIndex + 1 }} / {{ pages.length }} 页</span></header>
        <div class="memorization-columns">
          <table v-for="(column, columnIndex) in columns" :key="columnIndex" class="print-table" aria-label="单词与释义"><colgroup><col class="memorization-word" /><col /></colgroup><tbody><tr v-for="word in column" :key="word.spelling"><td>{{ word.spelling }}</td><td>{{ word.coreMeaning }}</td></tr></tbody></table>
        </div>
      </article>
    </div>
  </section>
</template>
