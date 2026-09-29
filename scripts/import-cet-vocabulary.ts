import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { validateCetVocabulary } from '../src/domain/cetVocabulary.ts'
import { excludeApprovedWords } from '../src/domain/exclusions.ts'
import type { VocabularyBundle, VocabularySource } from '../src/domain/types.ts'

const root = new URL('../', import.meta.url)
const raw = await readFile(new URL('data/upstream/cet/cet_full_list.json', root))
const source = JSON.parse(await readFile(new URL('data/upstream/cet/source.json', root), 'utf8')) as VocabularySource
const digest = createHash('sha256').update(raw).digest('hex')
if (digest !== source.sha256 || !/^[a-f0-9]{40}$/.test(source.commit) || !source.sourceUrl.includes(source.commit)) {
  throw new Error('四六级原始词表与固定来源不一致')
}
const { words, sixLevelIds, report } = validateCetVocabulary(JSON.parse(raw.toString('utf8')))
await mkdir(new URL('data/reports/', root), { recursive: true })
await writeFile(new URL('data/reports/cet-validation.json', root), JSON.stringify(report, null, 2) + '\n')
if (report.errorCount) throw new Error('四六级词表结构校验失败，未更新应用词库')

const exclusionText = await readFile(new URL('data/config/cet-exclusions.json', root), 'utf8')
const exclusion = JSON.parse(exclusionText) as {
  sourceCommit: string
  expectedBasicCount: number
  expectedRareCount: number
  basicWordIds: string[]
  rareWordIds: string[]
}
if (exclusion.sourceCommit !== source.commit || exclusion.expectedBasicCount !== 437 ||
  exclusion.expectedRareCount !== 122 || !Array.isArray(exclusion.basicWordIds) || !Array.isArray(exclusion.rareWordIds)) {
  throw new Error('六级排除清单版本或数量与确认范围不一致')
}
const afterBasic = excludeApprovedWords(words, exclusion.basicWordIds, exclusion.expectedBasicCount)
const activeWords = excludeApprovedWords(afterBasic, exclusion.rareWordIds, exclusion.expectedRareCount)
if (activeWords.length !== 4719) throw new Error(`六级保留数量异常：${activeWords.length}`)
const activeReport = {
  ...report,
  importedCount: activeWords.length,
  excludedCount: words.length - activeWords.length,
  originalSixLevelCount: sixLevelIds.size,
  retainedSixLevelCount: activeWords.filter(word => sixLevelIds.has(word.id)).length,
}
const exclusionVersion = createHash('sha256').update(exclusionText).digest('hex').slice(0, 12)
const bundle: VocabularyBundle = {
  schemaVersion: 1,
  contentVersion: `${source.commit}:exclude-${exclusionVersion}`,
  dictionaryId: 'cet6-2016-curated',
  title: '大学英语六级词汇（精选）',
  source,
  report: activeReport,
  words: activeWords,
}
await mkdir(new URL('public/data/', root), { recursive: true })
await writeFile(new URL('public/data/cet-vocabulary.json', root), JSON.stringify(bundle) + '\n')
await writeFile(new URL('public/data/cet-LICENSE.txt', root), await readFile(new URL('data/upstream/cet/LICENSE', root)))
await writeFile(new URL('data/reports/cet-validation.json', root), JSON.stringify(activeReport, null, 2) + '\n')

const spellings = new Map(words.map(word => [word.id, word]))
const reviewLines = [
  '# 六级精选词库排除清单', '',
  `来源：${source.repository}，固定提交 ${source.commit}；原表依据 2016 年修订版四六级大纲整理，不代表最新版官方词表。`, '',
  `原表 ${words.length} 词，基础词 ${exclusion.basicWordIds.length} 个，偏专业、场景较窄、过时或释义有问题的词 ${exclusion.rareWordIds.length} 个，保留 ${activeWords.length} 词。`,
  `原表标 ★ 的六级词 ${sixLevelIds.size} 个，保留 ${activeReport.retainedSixLevelCount} 个。排除只影响六级精选词库，不影响考研 5220 词。`, '',
  '## 基础词', '',
  '| 单词 | 原表释义 |', '| --- | --- |',
  ...exclusion.basicWordIds.map(id => `| ${spellings.get(id)?.spelling} | ${spellings.get(id)?.meaning} |`), '',
  '## 偏专业、低适用性或释义有误的词', '',
  '| 单词 | 原表释义 | 六级标记 |', '| --- | --- | --- |',
  ...exclusion.rareWordIds.map(id => `| ${spellings.get(id)?.spelling} | ${spellings.get(id)?.meaning} | ${sixLevelIds.has(id) ? '★' : ''} |`), '',
].join('\n')
if (exclusion.basicWordIds.some(id => !spellings.has(id)) || exclusion.rareWordIds.some(id => !spellings.has(id))) {
  throw new Error('六级排除清单中存在原表没有的词')
}
await writeFile(new URL('data/review/六级精选排除清单.md', root), reviewLines)
console.log(`六级词库导入完成：${words.length} - ${activeReport.excludedCount} = ${activeWords.length} 词；原表六级标记 ${sixLevelIds.size}，保留 ${activeReport.retainedSixLevelCount}。`)
