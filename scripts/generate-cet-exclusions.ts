import { readFile, writeFile } from 'node:fs/promises'

// One-time, reviewable selection. The importer reads the frozen output, never these inputs.
const root = new URL('../', import.meta.url)
const raw = JSON.parse(await readFile(new URL('data/upstream/cet/cet_full_list.json', root), 'utf8')) as Record<string, Array<Record<string, unknown>>>
const rows = raw['四六级词汇词频排序表']
const known = new Set(rows.map(row => row['单词'] as string))
const basicCandidates = JSON.parse(await readFile(new URL('data/review/basic-word-candidates.json', root), 'utf8')) as { words: { spelling: string }[] }
const basic = basicCandidates.words.map(word => word.spelling).filter(spelling => known.has(spelling))
const previousRare = await Promise.all([
  'data/config/excluded-rare-words.json',
  'data/config/excluded-low-frequency-extra.json',
].map(async path => (JSON.parse(await readFile(new URL(path, root), 'utf8')) as { wordIds: string[] }).wordIds.map(id => id.slice('netem:'.length))))
const supplementalRare = [
  'air-conditioning', 'almighty', 'aloft', 'apron', 'armor', 'artillery', 'ass', 'barometer',
  'barracks', 'bead', 'beak', 'beetle', 'Bible', 'binoculars', 'bitch', 'bouquet',
  'bridegroom', 'Buddhism', 'Catholic', 'Celsius', 'Christ', 'cigaret', 'clown', 'cock',
  'cockpit', 'colon', 'comma', 'Confucian', 'corporal', 'crocodile', 'Easter', 'embroidery',
  'fuck', 'gaol', 'gospel', 'hotdog', 'hyphen', 'nude', 'pants', 'parish',
]
const rare = [...new Set([...previousRare.flat(), ...supplementalRare])]
  .filter(spelling => known.has(spelling) && !basic.includes(spelling))
const errors = [...basic, ...rare].filter((spelling, index, all) => all.indexOf(spelling) !== index)
if (errors.length || basic.length !== 437 || rare.length !== 122) {
  throw new Error(`六级排除清单与审核基线不一致：基础 ${basic.length}，偏难怪 ${rare.length}，重复 ${errors.length}`)
}
const id = (spelling: string) => `cet:${encodeURIComponent(spelling.normalize('NFC').trim())}`
const config = {
  sourceCommit: '7f21d0d9ad93c16a17849a24ccc4046e0f64c4af',
  rationale: '从 5278 个四六级合并词条中排除已有基础候选词，并排除之前确认的偏专业低频词和新增场景较窄、过时或原表释义明显有误的词。不是官方考频判断。',
  expectedBasicCount: basic.length,
  expectedRareCount: rare.length,
  basicWordIds: basic.map(id),
  rareWordIds: rare.map(id),
}
await writeFile(new URL('data/config/cet-exclusions.json', root), JSON.stringify(config, null, 2) + '\n')
console.log(`固定六级排除清单：基础 ${basic.length}，偏难怪 ${rare.length}，总计 ${basic.length + rare.length}`)
