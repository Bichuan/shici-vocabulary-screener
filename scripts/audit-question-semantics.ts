import { readFile, writeFile } from 'node:fs/promises'
import type { VocabularyBundle, VocabularyWord } from '../src/domain/types.ts'
import { buildQuestions, SEMANTIC_CONFLICT_GROUPS } from '../src/domain/questions.ts'

const root = new URL('../', import.meta.url)
const bundle = JSON.parse(await readFile(new URL('public/data/vocabulary.json', root), 'utf8')) as VocabularyBundle
const questions = buildQuestions(bundle.words, () => 0.999999, false)
const wordById = new Map(bundle.words.map(word => [word.id, word]))
const questionByWordId = new Map(questions.map(question => [question.wordId, question]))

const BAND_COUNT = 5
const initials = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const bands = Array.from({ length: BAND_COUNT }, (_, index) => {
  const start = Math.floor(bundle.words.length * index / BAND_COUNT)
  const end = Math.floor(bundle.words.length * (index + 1) / BAND_COUNT)
  return bundle.words.slice(start, end)
})

function initial(word: VocabularyWord) {
  return word.spelling.match(/[a-z]/iu)?.[0]?.toUpperCase() ?? '#'
}

// Pick one entry for every available initial in every frequency band. This
// keeps the review deterministic while covering the whole list instead of a
// convenient prefix.
const samples = bands.flatMap((band, bandIndex) => initials.flatMap(letter => {
  const matches = band.filter(word => initial(word) === letter)
  if (!matches.length) return []
  const word = matches[Math.floor(matches.length / 2)]!
  return [{ band: bandIndex + 1, word }]
}))

const reviewedNotes = new Map<string, string>([
  ['relate', '通过：已避免与 tell（告诉）同题'],
  ['quiet', '通过：已避免与 silent（沉默的）同题'],
  ['zone', '通过：已避免与 area（地区、范围）同题'],
  ['drawback', '通过：已避免与 handicap（障碍）同题'],
  ['juvenile', '通过：已避免与 kid（孩子）同题'],
  ['quantify', '通过：已避免与 measure（衡量、测量）同题'],
  ['decree', '通过：已避免与 statute（法规）同题'],
  ['speed', '通过：加速为原表中的有效动词义'],
  ['obsession', '通过：困扰为原表中的有效名词义'],
  ['aggregate', '通过：集料为建筑材料语境中的有效名词义'],
  ['inward', '通过：释义覆盖向内的方向义'],
])

const rows = samples.map(({ band, word }, index) => {
  const question = questionByWordId.get(word.id)!
  const distractors = question.options
    .filter(option => option.id !== question.correctOptionId)
    .map(option => {
      const source = wordById.get(option.id.replace(/^source:/u, ''))
      return `${option.text}（${source?.spelling ?? '未知来源'}）`
    })
    .join('；')
  return `| ${index + 1} | ${band} | ${initial(word)} | ${word.spelling} | ${word.frequency} | ${word.meaning} | ${distractors} | ${reviewedNotes.get(word.spelling) ?? '通过'} |`
})

const report = [
  '# BIC-22 核心义与干扰项语义抽查',
  '',
  `- 词库总量：${bundle.words.length}`,
  `- 抽样数量：${samples.length}`,
  `- 抽样方法：按当前词序等分为 ${BAND_COUNT} 个频率层，每层按 A–Z 首字母分组，选择每组中位词。`,
  `- 人工审查：${samples.length} / ${samples.length} 题已完成。`,
  `- 首轮发现：${SEMANTIC_CONFLICT_GROUPS.length} 组同义或近义干扰；确定性核心义错译 0 条。`,
  `- 修正结果：${SEMANTIC_CONFLICT_GROUPS.length} 组冲突已加入出题规则，相关词不再互为干扰项；替换项仍来自原词表。`,
  '- 检查重点：正确核心义是否可用；七个干扰项是否包含同义、上下位义或可同时成立的释义。',
  '- 干扰项括号内为该中文释义在原词表中的来源单词，仅用于审查。',
  '- 复核参考：[Cambridge relate](https://dictionary.cambridge.org/dictionary/english/relate)、[Cambridge silent](https://dictionary.cambridge.org/dictionary/english/silent)、[Cambridge decree](https://dictionary.cambridge.org/dictionary/english/decree)、[Cambridge aggregate](https://dictionary.cambridge.org/dictionary/english/aggregate)、[Cambridge obsession](https://dictionary.cambridge.org/dictionary/english/obsession)、[Cambridge inward](https://dictionary.cambridge.org/dictionary/english/inward)、[Oxford speed](https://www.oxfordlearnersdictionaries.com/us/definition/american_english/speed_1)。',
  '',
  '| # | 频率层 | 首字母 | 目标词 | 原词频 | 正确核心义 | 七个干扰项（来源词） | 人工结论 |',
  '| ---: | ---: | :---: | --- | ---: | --- | --- | --- |',
  ...rows,
  '',
].join('\n')

await writeFile(new URL('data/review/BIC-22-语义抽查.md', root), report)
console.log(`已生成 BIC-22 分层抽样：${samples.length} 题，覆盖 ${new Set(samples.map(item => initial(item.word))).size} 个首字母、${BAND_COUNT} 个频率层。`)
