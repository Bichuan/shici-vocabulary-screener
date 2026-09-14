import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const readJson = async path => JSON.parse((await readFile(new URL(path, root), 'utf8')).replace(/^\uFEFF/, ''))
const source = await readJson('public/data/vocabulary.json')
const selection = await readJson('data/reports/basic-word-candidates.selection.json')
const lookup = new Map(source.words.map(word => [word.spelling, word]))
const seen = new Set()
const rows = []
const missing = []
const repeated = []
const reviewNotes = {
  week: '原释义有误：应为“周、星期”；周末是 weekend。未修改原库。',
  theirs: '原释义疑似缺字：应为“他们的/她们的/它们的（所有物）”。未修改原库。',
  head: '原释义“前往”是动词用法，未列基础名词义“头”；建议复核后决定。',
  face: '原释义“面对”是动词用法，未列基础名词义“脸”；建议复核后决定。',
  ruler: '原释义为“统治者”，未列基础词义“尺子”；建议复核后决定。',
  orange: '原释义仅列颜色义，未列“橙子”；分类按日常词义，建议复核。',
  mine: '包含“矿”等用法，不能仅按代词“我的”判断。',
  book: '包含“预订”用法，建议单独决定是否略过。',
  light: '涉及光、轻的、点亮等不同用法，建议单独决定是否略过。',
  minute: '原释义还含“微小的”，建议单独决定是否略过。',
  watch: '原释义为动词“观看”，也有名词“手表”，建议单独决定是否略过。',
}
for (const [category, list] of Object.entries(selection.分组)) {
  for (const spelling of list.split(/\s+/)) {
    if (seen.has(spelling)) { repeated.push(spelling); continue }
    seen.add(spelling)
    const word = lookup.get(spelling)
    if (!word) { missing.push(spelling); continue }
    rows.push({ ...word, reviewCategory: category, reviewNote: reviewNotes[spelling] ?? '', decision: 'pending' })
  }
}
console.log(JSON.stringify({ count: rows.length, missing, repeated, categories: Object.keys(selection.分组).map(category => [category, rows.filter(row => row.reviewCategory === category).length]) }, null, 2))
if (rows.length < 300 || rows.length > 500) throw new Error('候选数不在用户要求的 300–500 范围内')
if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('候选词存在重复标识')
await mkdir(new URL('data/review/', root), { recursive: true })
await writeFile(new URL('data/review/basic-word-candidates.json', root), JSON.stringify({
  purpose: selection.说明,
  sourceCommit: source.source.commit,
  originalCount: source.words.length,
  candidateCount: rows.length,
  unmatchedSpellings: missing,
  repeatedSelections: repeated,
  words: rows,
}, null, 2) + '\n')

const escape = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ')
const lines = [
  '# 基础常见词候选清单（待审核）', '',
  `从当前 NETEMVocabulary 固定词库的 **${source.words.length} 条**中，人工挑选 **${rows.length} 条**基础日常词汇供审核。正式词库未修改，所有决定均为待定。`, '',
  '筛选口径：基础功能词、数字日期、家庭身体、食物动物、家居学校和基本动作。不是按上游混合试卷词频直接取前若干名，也不是官方小学词表或对个人掌握程度的判断。中文释义照录当前词库，未新增或改写。', '',
  `如果全部略过，将剩余 **${source.words.length - rows.length} 条**，减少约 **${(rows.length / source.words.length * 100).toFixed(1)}%** 的首次筛查量。这里只做测算，不执行略过。`, '',
  '## 分类统计', '', '| 类别 | 候选数量 |', '| --- | ---: |',
  ...Object.keys(selection.分组).map(category => `| ${category} | ${rows.filter(row => row.reviewCategory === category).length} |`), '',
  '## 审核说明', '',
  '- 所有词均与现有词库精确匹配，并有稳定 ID；月份 May / March 与动词 may / march 不能简单合并。',
  '- 常见不代表所有用法都简单。book、class、letter、light、watch、second、will 等多义词，建议检查后再决定是否略过。',
  '- 可在“决定”列标注“略过”或“保留”；空白表示尚未决定。',
  `- 手工候选中未匹配到当前词库的拼写：${missing.join('、') || '无'}。这些词未计入候选，不另外补入正式词库。`, '',
  '### 这次发现的原始释义问题', '',
  '- week 原词库写作“周末”，应为“周、星期”；theirs 原词库为“们的”，疑似缺字。以下表格保留原文并注明问题，正式词库未改动。',
  '- head、face、ruler 等词原释义采用的是另一种有效用法，不宜仅凭“头、脸、尺子”熟悉就直接略过。', '',
]
let index = 0
for (const category of Object.keys(selection.分组)) {
  lines.push(`## ${category}`, '', '| 序号 | 单词 | 原词库中文释义 | 审核提示 | 决定 |', '| ---: | --- | --- | --- | --- |')
  for (const word of rows.filter(row => row.reviewCategory === category)) lines.push(`| ${++index} | ${escape(word.spelling)} | ${escape(word.meaning)} | ${escape(word.reviewNote)} | |`)
  lines.push('')
}
lines.push('## 来源', '', `[exam-data/NETEMVocabulary](${source.source.repository})；固定提交：${source.source.commit}。数据许可：${source.source.license}，完整许可见 data/upstream/LICENSE。候选清单只做筛选和分类，原始释义保持不变。`, '')
await writeFile(new URL('data/review/基础常见词候选清单.md', root), lines.join('\n'))
