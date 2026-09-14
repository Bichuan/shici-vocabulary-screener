import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'))
const bundle = await read('public/data/vocabulary.json')
const basic = await read('data/config/excluded-basic-words.json')
const rare = await read('data/config/excluded-rare-words.json')
const raw = await read('data/upstream/netem_full_list.json')
const lookup = new Map(bundle.words.map(word => [word.spelling, word]))
const originalLow = Object.values(raw)[0].filter(word => word['词频'] <= 2 && !basic.wordIds.includes(`netem:${encodeURIComponent(word['单词'])}`))
if (originalLow.length !== 447) throw new Error('最低频 447 词统计基线不一致')
const originalSpellings = new Set(originalLow.map(word => word['单词']))
const groups = {
  '家居器物': 'kettle lantern lid knob napkin pillow slipper stool tub vase',
  '饮食与容器': 'cabbage garlic melon mushroom peanut buffet vinegar mug jug pea',
  '动物与自然景物': 'camel crow goose goat ox swan dew mist waterfall sunset',
  '衣物与洗护用品': 'gown lace stocking vest wool comb shampoo razor scissors quilt',
  '生活动作与描述': 'giggle jolly darling fright idiot numb lick peep wink sniff',
  '活动与生活场景': 'badminton bowling outing gymnasium lavatory isle hound paw thorn hay',
}
const words = Object.entries(groups).flatMap(([category, list]) => list.split(' ').map(spelling => {
  const word = lookup.get(spelling)
  if (!word || !originalSpellings.has(spelling) || rare.wordIds.includes(word.id)) throw new Error(`不在可追加排除范围内：${spelling}`)
  return { ...word, category }
}))
if (words.length !== 60 || new Set(words.map(word => word.id)).size !== 60) throw new Error('应为 60 个不同单词')
await writeFile(new URL('data/config/excluded-low-frequency-extra.json', root), JSON.stringify({
  enabled: true, expectedCount: 60, sourceCommit: bundle.source.commit,
  reason: '用户授权从原最低频 447 词再选 50–100 词排除，本次选中 60 个生活场景词；不表示这些词都偏难或不会考。',
  selection: 'data/review/最低频447词完整统计.md', wordIds: words.map(word => word.id),
}, null, 2) + '\n')
const counts = [0, 1, 2].map(f => `${f} 次：${words.filter(word => word.frequency === f).length} 词`).join('；')
const lines = ['# 追加排除的 60 个低频词', '',
  '已按用户要求，从原最低频 447 词中追加排除 60 个，与先前 200 个基础词及 50 个低频细分词不重叠。', '',
  '选择口径：低频且偏日常器物、动植物、洗护、休闲和生活描述。这里不是又选 60 个“难偏怪”词，而是在低频范围内进一步压缩生活场景词。频次为原词库混合考试语料字段，不是考研专属频次。', '',
  '通用学术词 qualitative、configuration、variance 和 data、means、species 等继续保留。', '',
  `本轮原词频分布：${counts}。`, '',
  '应用词库：5,280 → 5,220；累计排除 310 词。原最低频 447 词中累计排除 110 词，剩余 337 词。', '',
  '| 序号 | 单词 | 原词库中文释义 | 原词频 | 分类 |', '| ---: | --- | --- | ---: | --- |',
  ...words.map((word, i) => `| ${i + 1} | ${word.spelling} | ${word.meaning} | ${word.frequency} | ${word.category} |`), '',
  '## 恢复', '',
  '将 data/config/excluded-low-frequency-extra.json 的 enabled 改为 false，再运行 npm run build，可只恢复本轮 60 词；其他两轮不变。历史词库和审核文件不删除。', '',
  `来源：exam-data/NETEMVocabulary，固定提交 ${bundle.source.commit}，数据许可 CC BY-NC-SA 4.0；释义按原库保留。`, '']
await writeFile(new URL('data/review/追加排除的60个低频词.md', root), lines.join('\n'))
console.log(`已选择 ${words.length} 个不重复的追加词。${counts}`)
