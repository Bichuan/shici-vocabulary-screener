import { readFile } from 'node:fs/promises'
import { buildQuestions } from '../src/domain/questions.ts'
import type { VocabularyBundle } from '../src/domain/types.ts'

const bundle = JSON.parse(await readFile(new URL('../public/data/ielts-vocabulary.json', import.meta.url), 'utf8')) as VocabularyBundle
const questions = buildQuestions(bundle.words, () => 0.5, false)
if (questions.length !== bundle.words.length) throw new Error('雅思词库部分词条无法出题')
console.log(`雅思题库校验通过：${questions.length} 道八选一。`)

if (process.argv.includes('--sample')) {
  const strata = ['address', 'book', 'charge', 'issue', 'present', 'august', 'abnormal', 'account for', 'zero']
  for (const question of questions.filter((question, index) => index % 125 === 0 || strata.includes(question.spelling))) {
    console.log(question.spelling, question.coreMeaning, '|', question.options.slice(1).map(option => option.text).join(' / '))
  }
}
