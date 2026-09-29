import { readFile, writeFile } from 'node:fs/promises'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { buildQuestions, QUESTION_VERSION, validateQuestions } from '../src/domain/questions.ts'

const root = new URL('../', import.meta.url)
const bundle = JSON.parse(await readFile(new URL('public/data/cet-vocabulary.json', root), 'utf8')) as VocabularyBundle
if (bundle.dictionaryId !== 'cet6-2016-curated' || bundle.words.length !== 4719) throw new Error('六级词库版本或数量异常')
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
  scope: '八个选项均复制自六级保留词条的原始中文释义；结构检查不能代替全部人工语义复核。',
}
await writeFile(new URL('data/reports/cet-questions.json', root), JSON.stringify(report, null, 2) + '\n')
const sample = questions.filter((_, index) => index % 100 === 0).slice(0, 48)
await writeFile(new URL('data/review/六级题目抽查.md', root), [
  '# 六级题目抽查', '',
  `共 ${questions.length} 道八选一题；下面按原词表顺序每 100 题抽取 1 题。`, '',
  '| 单词 | 正确释义 | 七个原表干扰项 |', '| --- | --- | --- |',
  ...sample.map(q => `| ${q.spelling} | ${q.coreMeaning} | ${q.options.filter(o => o.id !== q.correctOptionId).map(o => o.text).join(' / ')} |`), '',
].join('\n'))
if (issues.length) throw new Error(issues.join('\n'))
console.log(`六级题库校验通过：${questions.length} 道题，八个选项均来自原表。`)
