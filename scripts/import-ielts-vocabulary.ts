import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { VocabularyBundle, VocabularySource, VocabularyWord } from '../src/domain/types.ts'

type SourceRow = [spelling: string, translation: string, bncRank: number, corpusRank: number, forms: string]
const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')
const write = (path: string, content: string) => writeFile(new URL(path, root), content)
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')
const sourceText = await read('data/upstream/ielts/ecdict-ielts.json')
const source = JSON.parse(await read('data/upstream/ielts/source.json')) as VocabularySource
const curationText = await read('data/config/ielts-curation.json')
const { basicWords, preferredMeanings } = JSON.parse(curationText) as {
  basicWords: string[]
  preferredMeanings: Record<string, string>
}
if (sha256(sourceText.replaceAll('\r\n', '\n')) !== source.sha256 || !source.sourceUrl.includes(source.commit)) {
  throw new Error('雅思数据与固定 ECDICT 快照不一致')
}
const rows = JSON.parse(sourceText) as SourceRow[]
const excluded = new Set(basicWords)
const unique = new Set(rows.map(([word]) => word.normalize('NFC').trim().toLowerCase()))
if (rows.length !== 5040 || unique.size !== rows.length ||
    excluded.size !== basicWords.length || basicWords.some(word => !rows.some(row => row[0] === word))) {
  throw new Error('雅思数据行数、去重或基础词清单检查失败')
}

const meaningsByWord = new Map<string, string[]>()
function readMeanings(translation: string) {
  const lines = translation.split(/\\n|\r?\n/u)
  const glosses = lines.filter(line => !line.startsWith('['))
  return (glosses.some(line => /\p{Script=Han}/u.test(line)) ? glosses : lines)
    .flatMap(line => line.replace(/^(?:\[[^\]]+\]\s*|[a-z]+\.\s*)/u, '').split(/[,，;；、](?![^（(]*[）)])/u))
    .map(text => text.replace(/\s*[（(]\s*[a-z -]+的(?:名词)?(?:复数|第三人称单数)(?:形式)?\s*[）)]\s*$/iu, '').trim())
    .filter(text => /\p{Script=Han}/u.test(text))
}

// Lower BNC/COCA ranks indicate more frequent words. Unranked words go last.
const rank = (row: SourceRow) => row[2] || row[3] || Number.MAX_SAFE_INTEGER
const sorted = [...rows].sort((left, right) => rank(left) - rank(right) || left[0].localeCompare(right[0], 'en'))
const words: VocabularyWord[] = []
for (const [index, row] of sorted.entries()) {
  const [spelling, translation, , , exchange] = row
  const meanings = [...new Set(readMeanings(translation))]
  meaningsByWord.set(spelling, meanings)
  if (excluded.has(spelling)) continue
  const meaning = preferredMeanings[spelling] ?? meanings[0]
  if (!meaning || !meanings.includes(meaning)) throw new Error(`雅思核心义缺失或不在原词条中：${spelling} / ${meaning}`)
  const forms = exchange.split('/').map(form => form.split(':')[1]).filter((form): form is string => !!form)
  words.push({
    id: `ielts:${encodeURIComponent(spelling.toLowerCase())}`,
    spelling, meaning, sourceOrder: index + 1,
    frequency: rows.length - index,
    alternateSpelling: null, category: null, subcategory: null,
    alternateMeanings: meanings.filter(item => item !== meaning),
    inflections: [...new Set(forms)],
  })
}
for (const spelling of Object.keys(preferredMeanings)) {
  if (!meaningsByWord.has(spelling) || excluded.has(spelling)) throw new Error(`熟词生义配置无效：${spelling}`)
}
const report = {
  sourceCount: rows.length, excludedCount: excluded.size, importedCount: words.length, uniqueCount: words.length,
  emptyMeaningCount: 0, duplicateCount: 0, errorCount: 0, warningCount: 0, issues: [],
}
const bundle: VocabularyBundle = {
  schemaVersion: 1,
  contentVersion: `ecdict:${source.commit}:ielts-${sha256(JSON.stringify(words)).slice(0, 12)}`,
  dictionaryId: 'ielts-ecdict', title: '雅思词汇', source, report, words,
}
await mkdir(new URL('public/data/', root), { recursive: true })
await write('public/data/ielts-vocabulary.json', JSON.stringify(bundle) + '\n')
await write('public/data/ielts-LICENSE.txt', await read('data/upstream/ielts/LICENSE'))

const review = [
  '# 雅思基础词筛除', '',
  `ECDICT 雅思标签共 ${rows.length} 个不同拼写，排除 ${excluded.size} 个基础常用词，保留 ${words.length} 个词。`,
  '以已有基础词候选与雅思来源的交集为起点，逐项看原始义项。保留可能用于雅思语境的常见进阶义。', '',
  '| 基础词 | 原表首义 | 筛除理由 |', '| --- | --- | --- |',
  ...basicWords.map(word => `| ${word} | ${meaningsByWord.get(word)?.[0]} | 入门日常词汇，进阶优先级低 |`), '',
  '| 保留示例 | 所考释义 |', '| --- | --- |',
  ...Object.entries(preferredMeanings).map(([word, meaning]) => `| ${word} | ${meaning} |`), '',
].join('\n')
await write('data/review/雅思基础词筛除.md', review)
console.log(`雅思词库导入完成：${rows.length} - ${excluded.size} = ${words.length} 词。`)
