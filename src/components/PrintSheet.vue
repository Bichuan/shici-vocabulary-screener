<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions } from '../domain/questions.ts'
import { memorizationWords, readLearningBackup, validateLearningBackup, type MemorizationScope, type MemorizationWord } from '../domain/studyTools.ts'
import type { LearningDictionaryId } from '../domain/learningNamespace.ts'

const props = defineProps<{ words: VocabularyWord[]; dictionaryVersion: string; dictionaryId: LearningDictionaryId; scope: MemorizationScope }>()
const loading = ref(true)
const error = ref('')
const wordList = ref<MemorizationWord[]>([])
const count = computed(() => wordList.value.length)
const rows = computed(() => {
  const result: (MemorizationWord | null)[][] = []
  for (let index = 0; index < wordList.value.length; index += 3) {
    result.push([wordList.value[index] ?? null, wordList.value[index + 1] ?? null, wordList.value[index + 2] ?? null])
  }
  return result
})
function back() { window.location.hash = '#review' }
function printSheet() { window.print() }
onMounted(async () => {
  try {
    const backup = validateLearningBackup(await readLearningBackup(undefined, props.dictionaryVersion, props.dictionaryId), props.dictionaryVersion, buildSampleQuestions(props.words), props.dictionaryId)
    wordList.value = memorizationWords(backup, props.scope)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取错词记录。' }
  finally { loading.value = false }
})
</script>

<template>
  <section class="print-sheet" aria-label="错词背诵打印表">
    <div class="print-head no-print"><div><h1>{{ dictionaryId === 'netem-2024' ? '考研' : '六级' }}{{ scope === 'pending' ? '当前仍不会的词' : '错词' }}背诵表</h1><p>共 {{ count }} 词 · 每行 3 词，从左到右、逐行向下。若打印预览仍显示网址和日期，请在打印设置中关闭“页眉和页脚”。</p></div><div class="print-actions"><button class="secondary" @click="back">返回错词列表</button><button class="primary" :disabled="loading || !!error || !count" @click="printSheet">打印 / 保存为 PDF</button></div></div>
    <div v-if="loading" class="message-card" role="status">正在整理打印表…</div>
    <div v-else-if="error" class="message-card error" role="alert">{{ error }}</div>
    <div v-else-if="!count" class="message-card"><h2>{{ scope === 'pending' ? '暂无当前仍不会的词' : '暂无历史错词' }}</h2><p class="preview-note">{{ scope === 'pending' ? '待复筛的单词会自动出现在这里。' : '初筛答错的单词会自动出现在这里。' }}</p></div>
    <div v-else class="memorization-grid" role="table" aria-label="单词与释义">
      <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="memorization-row" role="row">
        <div v-for="(word, columnIndex) in row" :key="columnIndex" class="memorization-cell" role="cell">
          <div v-if="word" class="memorization-pair"><span>{{ word.spelling }}</span><span>{{ word.coreMeaning }}</span></div>
        </div>
      </div>
    </div>
  </section>
</template>
