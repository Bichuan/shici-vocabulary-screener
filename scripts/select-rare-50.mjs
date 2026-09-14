import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'))
const candidates = await read('data/review/low-frequency-candidates.json')
const basic = await read('data/config/excluded-basic-words.json')
const lookup = new Map(candidates.words.map(word => [word.spelling, word]))
const groups = {
  '计量、材料与化学细分词': 'quart watt volt voltage horsepower centigrade sulphur oxide distil alloy',
  '医学、生理与解剖细分词': 'aural bowel abdomen artery vein thigh skull physiology malignant pneumonia',
  '技术、机械与地理细分词': 'infrared ultraviolet supersonic cylinder valve coil antenna locomotive tanker longitude',
  '具体器物与材料词': 'brandy linen velvet ivory porcelain plaster rake oar paddle wrench',
  '特定文化、职衔与艺术词': 'clergy choir magistrate colonel repertoire esthetic lyric tempo mosaic siren',
}
const words = Object.entries(groups).flatMap(([category, list]) => list.split(' ').map(spelling => {
  const word = lookup.get(spelling)
  if (!word || word.frequency > 2 || basic.wordIds.includes(word.id)) throw new Error(`无效或重复排除：${spelling}`)
  return { id: word.id, spelling, meaning: word.meaning, frequency: word.frequency, category, reviewNote: word.reviewNote }
}))
if (words.length !== 50 || new Set(words.map(w => w.id)).size !== 50) throw new Error('必须正好选中 50 个不同词')
const config = {
  enabled: true,
  reason: '用户授权从 240 个候选中选 50 个偏专业、场景较窄的词默认排除。不是不会考的判断。',
  sourceCommit: candidates.sourceCommit,
  selection: 'data/review/low-frequency-candidates.json',
  expectedCount: 50,
  wordIds: words.map(word => word.id),
}
await writeFile(new URL('data/config/excluded-rare-words.json', root), JSON.stringify(config, null, 2) + '\n')
const lines = ['# 已排除的 50 个低频细分词', '',
  '状态：已按用户授权默认排除；与此前 200 个基础词不重叠。原始词库、240 词候选和历史审核表保留。', '',
  '筛选依据：原词库词频为 0–2，且词义偏细分学科、器物或特定场景。属于缩短个人筛查量的编辑取舍，不是官方难度排名或不会考的保证。qualitative、configuration、variance 等通用学术词继续保留。', '',
  '本轮前 5,330 词，本轮后 5,280 词；累计排除 250 词。', '',
  '原字段是混合考试语料词频，不是专门的考研真题次数。以下释义照录原词库；supersonic 的“超声波”释义有误，正确应为“超音速的”，此处注明而不修改原始快照。', '',
  '| 序号 | 单词 | 原词库释义 | 原词频 | 分类 |', '| ---: | --- | --- | ---: | --- |',
  ...words.map((w, i) => `| ${i + 1} | ${w.spelling} | ${w.meaning} | ${w.frequency} | ${w.category} |`), '',
  '## 恢复方式', '',
  '在 data/config/excluded-rare-words.json 中把 enabled 改为 false，再执行 npm run build，即可恢复本轮 50 词，保留此前 200 词排除决定。无需重新下载原始数据。不要重新执行 select-rare-50.mjs，除非要重新启用本轮决定。', '',
  `来源：exam-data/NETEMVocabulary，固定提交 ${candidates.sourceCommit}，数据许可 CC BY-NC-SA 4.0。`, '']
await writeFile(new URL('data/review/已排除的50个低频词.md', root), lines.join('\n'))
console.log(`已生成 ${words.length} 词排除配置和明细。`)
