import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const path = name => new URL(name, root)
const baselinePaths = ['data/review/basic-word-candidates.json', 'data/review/基础常见词候选清单.md', 'data/upstream/netem_full_list.json', 'public/data/vocabulary.json']
const hash = async name => createHash('sha256').update(await readFile(path(name))).digest('hex')
const before = await Promise.all(baselinePaths.map(hash))
const parent = JSON.parse(await readFile(path(baselinePaths[0]), 'utf8'))
const lookup = new Map(parent.words.map(word => [word.spelling, word]))

// Editorial shortlist, not a corpus-frequency ranking. No application exclusions are changed.
const groups = {
  '基础功能词与代词': 'a the I you he she it we they me him her us them my your his its our their and or but yes no not this that these those of to in on at for with from what how',
  '数字 1—10': 'one two three four five six seven eight nine ten',
  '日常时间与星期': 'today tomorrow yesterday morning afternoon evening night day month year hour Sunday Monday Tuesday Wednesday Thursday Friday Saturday birthday weekend',
  '家庭与常见人物': 'father mother brother sister son daughter family parent baby child boy girl man woman friend student teacher doctor nurse name',
  '身体部位': 'eye ear nose mouth tooth hair hand arm leg foot',
  '常见食物与饮品': 'apple banana grape lemon fruit vegetable potato tomato rice bread noodle egg meat beef pork fish milk water tea coffee',
  '动物与自然': 'cat dog bird cow pig horse sheep rabbit tiger lion elephant monkey panda tree flower grass sun moon sky snow',
  '学校与日常物品': 'school classroom lesson homework pen pencil desk bus bed door window bag box cup bottle soap towel computer telephone car',
  '基础形容词与颜色': 'good bad big small long short tall old young new hot cold warm happy sad white black red blue yellow',
  '基础日常动作': 'eat drink sleep walk run sit see hear listen speak talk ask know love buy sell wash cook sing swim',
}
const rows = []
for (const [category, spellings] of Object.entries(groups)) {
  for (const spelling of spellings.split(' ')) {
    const word = lookup.get(spelling)
    if (!word) throw new Error(`不在原 456 词清单中：${spelling}`)
    rows.push({ id: word.id, spelling: word.spelling, meaning: word.meaning, category, decision: 'pending' })
  }
}
if (rows.length !== 200 || new Set(rows.map(word => word.id)).size !== 200) throw new Error('必须是 200 个不重复的原清单词条')
const counts = Object.keys(groups).map(category => ({ category, count: rows.filter(row => row.category === category).length }))
const title = '200 个基础常见词候选清单（待审核）'
const lines = [
  `# ${title}`, '',
  '从原有 456 词候选清单中人工再筛选 200 个，供决定是否删除。原 456 词清单和正式 5,530 词库均保留，未执行删除或跳过。', '',
  '## 选词口径', '',
  '- 优先选择日常反复接触、基础词义容易直接识别的功能词、人物、数字、时间、物品和动作。',
  '- 这是针对本项目的人工基础词筛选，不是精确语料词频前 200 名，也不是官方小学必会清单。',
  '- 本次未选入原清单中的 book、mine、light、minute、ruler 等需要多义复核的词，以及 week、theirs 等已发现原释义问题的词；这些词仍留在原 456 词中。',
  '- 入选也不表示所有用法都简单，例如 run 还可表示“运转”。当前筛查目标只针对核心词义，是否删除仍由用户决定。',
  '- 中文释义逐项复制自原候选表，不重新改写；“决定”列留空，可填写“删除”或“保留”。',
  '- an 未在原 456 词中，本次不另行补入。', '',
  '## 数量统计', '',
  '| 项目 | 数量 |', '| --- | ---: |',
  '| 原候选清单 | 456 |', '| 本次精选候选 | 200 |', '| 原清单中本次未选入 | 256 |',
  '| 正式词库，未改动 | 5,530 |', '| 如果只删除本次 200 词，预计剩余 | 5,330 |', '',
  '本次候选占正式词库约 3.6%。仅作测算，尚未删除。', '',
  '| 类别 | 数量 |', '| --- | ---: |', ...counts.map(item => `| ${item.category} | ${item.count} |`), '',
]
let index = 0
for (const category of Object.keys(groups)) {
  lines.push(`## ${category}`, '', '| 序号 | 单词 | 原词库中文释义 | 决定 |', '| ---: | --- | --- | --- |')
  for (const word of rows.filter(row => row.category === category)) lines.push(`| ${++index} | ${word.spelling} | ${word.meaning.replaceAll('|', '\\|')} | |`)
  lines.push('')
}
lines.push('## 来源与校验', '',
  `来源：原 456 词候选清单；底层词库为 [exam-data/NETEMVocabulary](https://github.com/exam-data/NETEMVocabulary)，固定提交 ${parent.sourceCommit}。原词库数据许可为 CC BY-NC-SA 4.0，完整许可保存在 data/upstream/LICENSE。`, '',
  '生成时检查：200 个稳定 ID 无重复；所有词和释义均来自原 456 词；原候选 JSON、Markdown、原始词库和应用词库的 SHA-256 在运行前后一致。', '')
await mkdir(path('data/review/'), { recursive: true })
await writeFile(path('data/review/200个基础常见词候选清单.md'), lines.join('\n'))
await writeFile(path('data/review/basic-200-candidates.json'), JSON.stringify({
  purpose: '原 456 词的人工基础词精选，仅供审核，未删除正式词库。',
  sourceCommit: parent.sourceCommit, parentCandidateCount: parent.words.length,
  candidateCount: rows.length, remainingIfRemoved: 5530 - rows.length, categories: counts, words: rows,
}, null, 2) + '\n')
const after = await Promise.all(baselinePaths.map(hash))
if (before.some((value, i) => value !== after[i])) throw new Error('原文件意外发生变化')
console.log(JSON.stringify({ count: rows.length, categories: counts, originalFilesUnchanged: true }, null, 2))
