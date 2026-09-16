<script setup lang="ts">
import { ref, watch } from 'vue'
import type { VocabularyWord } from '../domain/types.ts'
import { buildSampleQuestions } from '../domain/questions.ts'
import { historicalWrongWords, readLearningBackup, validateLearningBackup } from '../domain/studyTools.ts'

const props = defineProps<{ words: VocabularyWord[]; dictionaryVersion: string; active: boolean }>()
const answeredCount = ref(0)
const wrongCount = ref(0)
const loading = ref(false)
const error = ref('')

async function loadSummary() {
  if (!props.active || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const questions = buildSampleQuestions(props.words, () => 0.999999, false)
    const backup = validateLearningBackup(
      await readLearningBackup(indexedDB, props.dictionaryVersion),
      props.dictionaryVersion,
      questions,
    )
    answeredCount.value = backup.initial?.records.length ?? 0
    wrongCount.value = historicalWrongWords(backup).length
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '暂时无法读取本机学习进度。'
  } finally {
    loading.value = false
  }
}

function revealInstallGuide(event: Event) {
  const guide = event.currentTarget as HTMLDetailsElement
  if (guide.open) requestAnimationFrame(() => guide.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}

watch(() => props.active, active => { if (active) void loadSummary() }, { immediate: true })
</script>

<template>
  <section class="home-dashboard" aria-labelledby="home-title">
    <header class="home-heading">
      <div>
        <div class="eyebrow">YOUR WORDS, YOUR PACE</div>
        <h1 id="home-title">从这里继续筛查。</h1>
        <p>一次一个词，进度自动保存在当前设备。</p>
      </div>
      <span class="home-local-state"><span class="local-dot" aria-hidden="true"></span>仅存本机</span>
    </header>

    <div class="home-progress-card" :aria-busy="loading">
      <div>
        <span>当前筛查进度</span>
        <strong>{{ answeredCount.toLocaleString('en-US') }}<small> / {{ words.length.toLocaleString('en-US') }} 词</small></strong>
      </div>
      <progress :value="answeredCount" :max="words.length || 1" aria-label="当前筛查进度"></progress>
      <p v-if="loading" role="status">正在读取本机记录…</p>
      <p v-else-if="error" class="home-error" role="alert">{{ error }}</p>
      <p v-else>{{ answeredCount ? '已经筛过的词不会重复出现，可以直接接着继续。' : '还没有筛查记录，可以从第一个词开始。' }}</p>
    </div>

    <nav class="home-actions" aria-label="首页主要操作">
      <a class="home-action home-action-primary" href="#screening">
        <span class="home-action-icon" aria-hidden="true">◎</span>
        <span><strong>{{ answeredCount ? '继续筛查' : '开始筛查' }}</strong><small>{{ answeredCount ? `从第 ${answeredCount + 1} 个词继续` : '进入八选一筛查' }}</small></span>
        <span class="home-action-arrow" aria-hidden="true">→</span>
      </a>
      <a class="home-action" href="#review">
        <span class="home-action-icon" aria-hidden="true">▧</span>
        <span><strong>错词复筛</strong><small>历史错词 {{ wrongCount }} 个</small></span>
        <span class="home-action-arrow" aria-hidden="true">→</span>
      </a>
      <a class="home-action" href="#review-tools">
        <span class="home-action-icon" aria-hidden="true">⇩</span>
        <span><strong>备份与恢复</strong><small>导出或导入本机记录</small></span>
        <span class="home-action-arrow" aria-hidden="true">→</span>
      </a>
      <a class="home-action home-action-danger" href="#screening-tools">
        <span class="home-action-icon" aria-hidden="true">↺</span>
        <span><strong>重新开始</strong><small>{{ answeredCount ? `管理当前 ${answeredCount} 条记录` : '当前没有筛查记录' }}</small></span>
        <span class="home-action-arrow" aria-hidden="true">→</span>
      </a>
    </nav>

    <a class="home-vocabulary-link" href="#vocabulary">查看完整词库与数据来源 <span aria-hidden="true">→</span></a>
    <details class="install-guide" @toggle="revealInstallGuide">
      <summary><span>添加到 iPhone 主屏幕</span><small>查看安装步骤</small></summary>
      <div>
        <ol>
          <li>用 iPhone 的 <strong>Safari</strong> 打开拾词的网址。</li>
          <li>点击 Safari 底部的<strong>分享按钮</strong>（方框向上箭头）。</li>
          <li>在分享菜单中选择<strong>添加到主屏幕</strong>。</li>
          <li>确认名称为“拾词”，点击右上角的<strong>添加</strong>。</li>
        </ol>
        <p>以后直接点击主屏幕上的“拾词”即可独立打开。应用按竖屏优先设计。</p>
      </div>
    </details>
  </section>
</template>
