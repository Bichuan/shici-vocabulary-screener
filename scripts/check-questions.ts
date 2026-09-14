import { readFile, writeFile } from 'node:fs/promises'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildQuestions, QUESTION_VERSION, validateQuestions } from '../src/domain/questions.ts'

const root = new URL('../', import.meta.url)
const bundle = JSON.parse(await readFile(new URL('public/data/vocabulary.json', root), 'utf8')) as VocabularyBundle
const questions = buildQuestions(bundle.words, () => 0.999999, false)
const issues = validateQuestions(questions, bundle.words)
const report = {
  questionVersion: QUESTION_VERSION,
  dictionaryVersion: bundle.contentVersion,
  dictionaryCount: bundle.words.length,
  questionCount: questions.length,
  pendingCount: 0,
  errorCount: issues.length,
  issues,
  sourceOnly: true,
  scope: '检查全部题目的正确项和干扰项均直接来自当前原始词表，并保证每题八项文本不同。近义词造成的语义歧义仍需持续人工抽查。',
}
await writeFile(new URL('data/reports/questions.json', root), JSON.stringify(report, null, 2) + '\n')
const review = [
  '# 全量题库数据检查', '',
  '全部正确释义和七个干扰项均直接复制自当前保留的原始词表，不新增中文释义。选项显示时只改变位置。', '',
  `当前词库 ${report.dictionaryCount} 词；已生成 ${report.questionCount} 道题；待制作 ${report.pendingCount} 题。`, '',
  '以下为前 48 道抽查表。完整结构由 data/reports/questions.json 记录统计，避免重复生成超长文档。', '',
  '| 单词 | 原始分类 | 正确释义 | 七个原表干扰项 |',
  '| --- | --- | --- | --- |',
  ...questions.slice(0, 48).map(q => `| ${q.spelling} | ${q.partOfSpeech} | ${q.coreMeaning} | ${q.options.filter(o => o.id !== q.correctOptionId).map(o => o.text).join(' / ')} |`), '',
].join('\n')
await writeFile(new URL('data/review/全量题库抽查.md', root), review)
if (issues.length) throw new Error(issues.join('\n'))
console.log(`全量题库校验通过：${questions.length} 道；全部选项来自当前 ${bundle.words.length} 词的原始释义。`)
