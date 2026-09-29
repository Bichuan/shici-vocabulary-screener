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
    <div v-else class="memorization-flow" role="list" aria-label="单词与释义">
      <div v-for="word in wordList" :key="word.spelling" class="memorization-entry" role="listitem"><span>{{ word.spelling }}</span><span>{{ word.coreMeaning }}</span></div>
    </div>
  </section>
</template>
