<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { VocabularyBundle } from './domain/types.ts'
import ScreeningSession from './components/ScreeningSession.vue'
import ReviewPanel from './components/ReviewPanel.vue'
import PrintSheet from './components/PrintSheet.vue'
import HomeDashboard from './components/HomeDashboard.vue'

function resolveView(hash: string) {
  if (hash === '#print') return 'print'
  if (hash === '#review' || hash === '#review-tools') return 'review'
  if (hash === '#screening' || hash === '#screening-tools') return 'screening'
  if (hash === '#vocabulary') return 'vocabulary'
  return 'home'
}
const view = ref(resolveView(location.hash))
async function scrollToAnchor() {
  const id = location.hash.slice(1)
  if (!['review-tools', 'screening-tools'].includes(id)) return
  await nextTick()
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
}
function syncView() { view.value = resolveView(location.hash); void scrollToAnchor() }
onMounted(() => { window.addEventListener('hashchange', syncView); void scrollToAnchor() })
onUnmounted(() => window.removeEventListener('hashchange', syncView))

const bundle = ref<VocabularyBundle | null>(null)
const loading = ref(true)
const error = ref('')
const query = ref('')
const sort = ref('source')
const page = ref(1)
const pageSize = 20
const tableTop = ref<HTMLElement | null>(null)
const licenseUrl = `${import.meta.env.BASE_URL}data/LICENSE.txt`
const ZOOM_STORAGE_KEY = 'shici-interface-zoom'
const MIN_ZOOM = 80
const MAX_ZOOM = 150
const ZOOM_STEP = 10

function savedZoom() {
  try {
    const value = Number(localStorage.getItem(ZOOM_STORAGE_KEY))
    return Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM ? value : 100
  } catch {
    return 100
  }
}

const zoomPercent = ref(savedZoom())
function setZoom(value: number) {
  zoomPercent.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  document.documentElement.style.setProperty('zoom', String(zoomPercent.value / 100))
  try { localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomPercent.value)) } catch { /* 页面仍可缩放 */ }
}
function handleZoomShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const zoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
  const zoomOut = event.key === '-' || event.code === 'NumpadSubtract'
  const reset = event.key === '0' || event.code === 'Numpad0'
  if (!zoomIn && !zoomOut && !reset) return
  event.preventDefault()
  setZoom(reset ? 100 : zoomPercent.value + (zoomIn ? ZOOM_STEP : -ZOOM_STEP))
}
onMounted(() => {
  setZoom(zoomPercent.value)
  window.addEventListener('keydown', handleZoomShortcut)
})
onUnmounted(() => window.removeEventListener('keydown', handleZoomShortcut))

async function loadVocabulary() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/vocabulary.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as VocabularyBundle
    if (data.schemaVersion !== 1 || !Array.isArray(data.words) || !data.source?.commit || !data.report || data.report.errorCount !== 0 || data.words.length !== data.report.importedCount) {
      throw new Error('词库文件格式不正确')
    }
    bundle.value = data
  } catch {
    error.value = '词库暂时无法读取，请重试。如果仍失败，请在项目目录运行 npm run import:vocabulary。'
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const search = query.value.trim().toLowerCase()
  const words = (bundle.value?.words ?? []).filter(word => !search ||
    word.spelling.toLowerCase().includes(search) || word.meaning.includes(search) || word.alternateSpelling?.toLowerCase().includes(search))
  return sort.value === 'alphabet' ? [...words].sort((a, b) => a.spelling.localeCompare(b.spelling, 'en')) : words
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visibleWords = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const rangeStart = computed(() => filtered.value.length ? (page.value - 1) * pageSize + 1 : 0)
const rangeEnd = computed(() => Math.min(page.value * pageSize, filtered.value.length))
watch([query, sort], () => { page.value = 1 })
function turnPage(next: number) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
  tableTop.value?.scrollIntoView({ block: 'start' })
}
function browse() { document.getElementById('vocabulary')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(loadVocabulary)
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="拾词首页"><span class="brand-icon">拾</span><span>拾词<small>考研词汇筛查器</small></span></a>
      <div class="nav-caption">我的学习空间</div>
      <nav aria-label="主要导航">
        <a class="nav-item" :class="{ active: view === 'home' }" href="#" :aria-current="view === 'home' ? 'page' : undefined"><span aria-hidden="true">⌂</span> 首页</a>
        <a class="nav-item" :class="{ active: view === 'screening' }" href="#screening" :aria-current="view === 'screening' ? 'page' : undefined"><span aria-hidden="true">◎</span> 单词筛查 <small>完整版</small></a>
        <a class="nav-item" :class="{ active: view === 'review' }" href="#review" :aria-current="view === 'review' ? 'page' : undefined"><span aria-hidden="true">▧</span> 错词与复筛</a>
        <a class="nav-item" :class="{ active: view === 'vocabulary' }" href="#vocabulary" :aria-current="view === 'vocabulary' ? 'page' : undefined"><span aria-hidden="true">▤</span> 完整词库</a>
      </nav>
      <div class="sidebar-note"><span class="local-dot"></span> 个人本地版<p>一步一步，找到需要背的词。</p></div>
    </aside>

    <main>
      <header class="topbar">
        <span>我的学习空间 <span class="crumb">/</span> <strong>{{ view === 'print' ? '错词背诵表' : view === 'review' ? '错词与复筛' : view === 'screening' ? '单词筛查' : view === 'vocabulary' ? '完整词库' : '首页' }}</strong></span>
        <div class="zoom-controls" role="group" aria-label="界面缩放">
          <button type="button" :disabled="zoomPercent === MIN_ZOOM" aria-label="缩小界面" title="缩小（Ctrl+-）" @click="setZoom(zoomPercent - ZOOM_STEP)">−</button>
          <button type="button" class="zoom-value" :aria-label="`恢复默认缩放，当前 ${zoomPercent}%`" title="恢复 100%（Ctrl+0）" @click="setZoom(100)">{{ zoomPercent }}%</button>
          <button type="button" :disabled="zoomPercent === MAX_ZOOM" aria-label="放大界面" title="放大（Ctrl++）" @click="setZoom(zoomPercent + ZOOM_STEP)">＋</button>
        </div>
      </header>
      <nav v-if="view !== 'print'" class="mobile-nav" aria-label="移动端导航">
        <a href="#" :aria-current="view === 'home' ? 'page' : undefined"><span aria-hidden="true">⌂</span><small>首页</small></a>
        <a href="#screening" :aria-current="view === 'screening' ? 'page' : undefined"><span aria-hidden="true">◎</span><small>筛查</small></a>
        <a href="#review" :aria-current="view === 'review' ? 'page' : undefined"><span aria-hidden="true">▧</span><small>错词</small></a>
        <a href="#review-tools"><span aria-hidden="true">⇅</span><small>备份</small></a>
      </nav>
      <div class="content">
        <section v-if="view === 'vocabulary'" class="intro">
          <div class="eyebrow">YOUR WORDS, YOUR PACE</div>
          <h1>从一份清晰的词库开始。</h1>
          <p>保留简短的核心释义，让每一次筛选都更轻松。</p>
        </section>

        <div v-if="loading" class="message-card" role="status">正在读取本地词库…</div>
        <div v-else-if="error" class="message-card error" role="alert"><p>{{ error }}</p><button class="primary" @click="loadVocabulary">重新加载</button></div>

        <template v-else-if="bundle">
          <HomeDashboard v-show="view === 'home'" :words="bundle.words" :dictionary-version="bundle.contentVersion" :active="view === 'home'" />
          <ScreeningSession v-show="view === 'screening'" :words="bundle.words" :dictionary-version="bundle.contentVersion" :active="view === 'screening'" />
          <ReviewPanel v-show="view === 'review'" :words="bundle.words" :dictionary-version="bundle.contentVersion" :active="view === 'review'" />
          <PrintSheet v-if="view === 'print'" :words="bundle.words" :dictionary-version="bundle.contentVersion" />
          <div v-show="view === 'vocabulary'">
          <section class="dictionary-card" aria-label="当前词库">
            <div class="dictionary-info">
              <div class="pills"><span class="pill">当前词库</span><span class="source-tag">NETEMVocabulary</span></div>
              <h2>考研英语词汇<span class="edition">2024 大纲整理版</span></h2>
              <p>英文单词 + 简短中文释义，保留原始词表的简洁表达。</p>
              <button class="primary" @click="browse">浏览词库 <span aria-hidden="true">↗</span></button>
              <a class="secondary preview-entry" href="#screening">体验八选一题目 →</a>
            </div>
            <div class="word-count"><span>已载入词条</span><strong>{{ bundle.words.length.toLocaleString('en-US') }}<small>词</small></strong><span class="count-foot">固定版本 · 本地读取</span></div>
          </section>

          <div class="metrics" aria-label="词库检查结果">
            <div><span class="metric-icon" aria-hidden="true">✓</span><p>结构检查<strong>{{ bundle.report.errorCount === 0 ? '已通过' : '需检查' }}</strong></p></div>
            <div><span class="metric-icon" aria-hidden="true">≡</span><p>空白释义<strong>{{ bundle.report.emptyMeaningCount }} <small>条</small></strong></p></div>
            <div><span class="metric-icon" aria-hidden="true">⊞</span><p>重复拼写<strong>{{ bundle.report.duplicateCount }} <small>条</small></strong></p></div>
          </div>

          <section id="vocabulary" ref="tableTop" class="vocabulary-section">
            <div class="section-heading"><div><h2>词库一览</h2><p>先看看这些词和它们的核心意思。</p></div><span class="total">共 {{ bundle.words.length.toLocaleString('en-US') }} 词</span></div>
            <div class="toolbar">
              <label class="search"><span aria-hidden="true">⌕</span><input v-model="query" type="search" placeholder="搜索英文单词或中文释义…" aria-label="搜索英文单词或中文释义" /><button v-if="query" class="clear-search" @click="query = ''" aria-label="清空搜索">×</button></label>
              <label class="sort-label"><span>排序</span><select v-model="sort" aria-label="词库排序"><option value="source">原词表顺序</option><option value="alphabet">字母 A—Z</option></select></label>
            </div>
            <div class="table-wrap">
              <table><thead><tr><th class="number-col" scope="col">序号</th><th scope="col">英文单词</th><th scope="col">中文释义</th></tr></thead>
                <tbody><tr v-for="word in visibleWords" :key="word.id"><td class="row-number">{{ word.sourceOrder.toString().padStart(3, '0') }}</td><td class="spelling">{{ word.spelling }}<span v-if="word.alternateSpelling" class="alternate">{{ word.alternateSpelling }}</span></td><td class="meaning">{{ word.meaning }}</td></tr></tbody>
              </table>
              <div v-if="!visibleWords.length" class="empty-state"><strong>没有找到匹配的单词</strong><p>试试其他拼写或中文关键词。</p><button class="secondary" @click="query = ''">查看全部词汇</button></div>
            </div>
            <div class="pagination"><span role="status" aria-live="polite">显示 {{ rangeStart }}–{{ rangeEnd }} 条，共 {{ filtered.length.toLocaleString('en-US') }} 条</span><div><button class="page-button" :disabled="page === 1" @click="turnPage(page - 1)" aria-label="上一页">←</button><span>{{ page }} <span class="slash">/</span> {{ totalPages }}</span><button class="page-button" :disabled="page === totalPages" @click="turnPage(page + 1)" aria-label="下一页">→</button></div></div>
          </section>

          <details class="source-details"><summary>词库来源与检查说明 <span>可追溯的原始数据</span></summary><div>
            <p>来源：<a :href="bundle.source.repository" target="_blank" rel="noreferrer">exam-data / NETEMVocabulary ↗</a>，第三方按 2024 年大纲整理，尚未核对更新年份大纲。</p>
            <p>固定快照：<code>{{ bundle.source.commit.slice(0, 12) }}</code>。数据采用 <a :href="licenseUrl" target="_blank" rel="noreferrer">{{ bundle.source.license }}</a> 许可，原始释义保持不变。</p>
            <p>原词库 {{ bundle.report.sourceCount.toLocaleString('en-US') }} 条，已按确认清单排除 {{ bundle.report.excludedCount ?? 0 }} 个词（基础词及低频细分词），当前保留 {{ bundle.words.length.toLocaleString('en-US') }} 条。</p>
            <p>全部 5,220 个词均可筛查，正确项和七个干扰项都直接取自原始词表。进度与错词自动保存在当前浏览器，支持错词复筛、导出和打印。</p>
            <ul v-if="bundle.report.issues.length"><li v-for="(item, index) in bundle.report.issues" :key="index">{{ item.word }}：{{ item.message }}</li></ul>
          </div></details>
          </div>
          <footer>拾词 <span>·</span> 把时间留给真正需要背的词。<span class="footer-right">个人本地版 / 词库预览</span></footer>
        </template>
      </div>
    </main>
  </div>
</template>

