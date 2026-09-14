import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateVocabulary } from '../src/domain/vocabulary.ts'
import { excludeApprovedWords } from '../src/domain/exclusions.ts'
import type { VocabularyBundle, VocabularySource } from '../src/domain/types.ts'

const root = new URL('../', import.meta.url)
const raw = await readFile(new URL('data/upstream/netem_full_list.json', root))
const source: VocabularySource = JSON.parse((await readFile(new URL('data/upstream/source.json', root), 'utf8')).replace(/^\uFEFF/, ''))
const digest = createHash('sha256').update(raw).digest('hex')
if (digest !== source.sha256) throw new Error('原始词库 SHA-256 不一致。请核对来源，不能静默覆盖固定版本。')
if (!/^[a-f0-9]{40}$/.test(source.commit) || !source.sourceUrl.includes(source.commit)) throw new Error('词库来源必须绑定完整提交版本')
const { words, report } = validateVocabulary(JSON.parse(raw.toString('utf8')))
await mkdir(new URL('data/reports/', root), { recursive: true })
await writeFile(new URL('data/reports/validation.json', root), JSON.stringify(report, null, 2) + '\n')
if (report.errorCount) {
  console.error(report)
  throw new Error('词库结构校验失败，未发布应用词库。请查看 data/reports/validation.json')
}
const exclusionText = await readFile(new URL('data/config/excluded-basic-words.json', root), 'utf8')
const exclusion = JSON.parse(exclusionText) as { sourceCommit: string; expectedCount: number; wordIds: string[] }
if (exclusion.sourceCommit !== source.commit || exclusion.expectedCount !== 200 || !Array.isArray(exclusion.wordIds)) {
  throw new Error('排除配置与已确认的 200 词或原始词库版本不一致')
}
const rareText = await readFile(new URL('data/config/excluded-rare-words.json', root), 'utf8')
const rare = JSON.parse(rareText) as { enabled: boolean; sourceCommit: string; expectedCount: number; wordIds: string[] }
if (rare.sourceCommit !== source.commit || rare.expectedCount !== 50 || typeof rare.enabled !== 'boolean' || !Array.isArray(rare.wordIds)) {
  throw new Error('低频词排除配置与已确认的 50 词或原始版本不一致')
}
const afterBasic = excludeApprovedWords(words, exclusion.wordIds, exclusion.expectedCount)
// Always validate the list, even while restored; this catches overlap with the basic exclusions.
const afterRare = excludeApprovedWords(afterBasic, rare.wordIds, rare.expectedCount)
const extraText = await readFile(new URL('data/config/excluded-low-frequency-extra.json', root), 'utf8')
const extra = JSON.parse(extraText) as { enabled: boolean; sourceCommit: string; expectedCount: number; wordIds: string[] }
if (extra.sourceCommit !== source.commit || extra.expectedCount !== 60 || typeof extra.enabled !== 'boolean' || !Array.isArray(extra.wordIds)) {
  throw new Error('追加低频词配置与已确认的 60 词或原始版本不一致')
}
// Validate all three lists together even if a batch is temporarily restored.
excludeApprovedWords(afterRare, extra.wordIds, extra.expectedCount)
const beforeExtra = rare.enabled ? afterRare : afterBasic
const activeWords = extra.enabled ? excludeApprovedWords(beforeExtra, extra.wordIds, extra.expectedCount) : beforeExtra
const activeReport = { ...report, importedCount: activeWords.length, excludedCount: words.length - activeWords.length }
const exclusionVersion = createHash('sha256').update(exclusionText).update(rareText).update(extraText).digest('hex').slice(0, 12)
const bundle: VocabularyBundle = {
  schemaVersion: 1,
  contentVersion: `${source.commit}:exclude-${exclusionVersion}`,
  dictionaryId: 'netem-2024',
  title: '考研英语词汇',
  source,
  report: activeReport,
  words: activeWords,
}
await writeFile(new URL('data/reports/validation.json', root), JSON.stringify(activeReport, null, 2) + '\n')
await mkdir(new URL('public/data/', root), { recursive: true })
await writeFile(new URL('public/data/vocabulary.json', root), JSON.stringify(bundle) + '\n')
await writeFile(new URL('public/data/LICENSE.txt', root), await readFile(new URL('data/upstream/LICENSE', root)))
console.log(`词库导入完成：原始 ${words.length} 条，排除 ${activeReport.excludedCount} 条，剩余 ${activeWords.length} 条；错误 ${report.errorCount} 项，提示 ${report.warningCount} 项。`)
console.log(`版本：${source.commit.slice(0, 12)}；报告：${fileURLToPath(new URL('data/reports/validation.json', root))}`)
for (const item of report.issues) console.log(`[${item.severity}] ${item.word ?? ''} ${item.message}`)
