import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const at = name => new URL(name, root)
const hash = async name => createHash('sha256').update(await readFile(at(name))).digest('hex')
const protectedFiles = ['public/data/vocabulary.json', 'data/upstream/netem_full_list.json', 'data/config/excluded-basic-words.json', 'data/review/basic-word-candidates.json', 'data/review/basic-200-candidates.json']
const before = await Promise.all(protectedFiles.map(hash))
const bundle = JSON.parse(await readFile(at('public/data/vocabulary.json'), 'utf8'))
const lookup = new Map(bundle.words.map(word => [word.spelling, word]))
const groups = {
  '科技、医学与自然专业词': 'alloy antenna artery abdomen physiology radioactive watt electron equator longitude paralyse static symmetry valve variance vibrate volatile volt infrared botany aural bowel corrode cylinder decimal horsepower influenza locomotive parasite qualitative quarantine quart reptile soluble spine sulphur thigh vein centigrade oxide spiral triangle cohesive configuration contagious distil inverse malignant nylon opaque pneumonia skull ultraviolet voltage composite discrete eclipse supersonic',
  '偏书面的抽象词与表达': 'albeit concurrent daunting deceit desolate ebb inflict invoke overt persecute proximate resultant strenuous strife accustom cunning fragrant hysterical mischief hypocrisy invert bewilder necessitate obstruct denounce deplore fabricate pathetic recollect retort stipulate thereafter unanimous agitate amiable contingent culprit interim ruthless anguish appal brevity coarse cordial deduct degenerate henceforth inaugurate nostalgic obsolete redeem relish salient sane snobbish stagger streamline temporal trifle whirl wrench',
  '宗教、军事、法律与历史文化': 'Bible Catholic Christ Christian colonel magistrate majesty Marxist plaintiff proceedings prophet clergy cannon missile royalty scout shepherd slaughter assassinate comrade oath siege witch ivory porcelain mosaic lyric esthetic cemetery',
  '较细分的物品、动作与场景': 'brandy brace cradle grease hound jug linen mug oar outskirts peep quiver rim salute sniff sponge sprinkle squirrel sting stocking tanker thorn velvet vinegar wicked wink zigzag zoom bait coil lumber choir cloak debut dwelling panorama rake repertoire auditorium capsule clutch exterior fellowship gown hay isle jolly lace lavatory maiden pebble sew siren sophomore stationery trench zip paddle plaster ax batch blade buffet cellar comet dew drip fright fringe gang knob lid militant mutter overhear paw radiant reel remainder riddle seam shutter sprout tempo tiresome tub wax wrinkle numb bark dusk foam fragrant',
}
const notes = {
  botany: '原释义“植物”不完整，通常应为“植物学”；未改原库。',
  supersonic: '原释义“超声波”不准确，应为“超音速的”；未改原库。',
  temporal: '原释义“暂时的”需复核，常见为“时间的、世俗的”；未改原库。',
  soluble: '原释义只列“可解决的”，需同时核对“可溶解的”；未改原库。',
  judicial: '原释义“公正的、司法的”需复核。',
}
const seen = new Set()
const selected = []
for (const [category, text] of Object.entries(groups)) {
  for (const spelling of text.split(' ')) {
    if (seen.has(spelling)) continue
    const word = lookup.get(spelling)
    if (!word || word.frequency > 2) throw new Error(`非当前最低频范围词条：${spelling}`)
    seen.add(spelling)
    selected.push({ ...word, reviewCategory: category, reviewNote: notes[spelling] ?? '', decision: 'pending' })
  }
}
const order = (a, b) => a.frequency - b.frequency || a.spelling.localeCompare(b.spelling, 'en')
selected.sort(order)
const low = bundle.words.filter(word => word.frequency <= 2).sort(order)
if (selected.length < 200 || selected.length > 500 || new Set(selected.map(w => w.id)).size !== selected.length) throw new Error('候选数量或唯一性错误')
const distribution = [0, 1, 2].map(frequency => ({ frequency, total: low.filter(w => w.frequency === frequency).length, selected: selected.filter(w => w.frequency === frequency).length }))
const totals = Object.keys(groups).map(category => ({ category, count: selected.filter(w => w.reviewCategory === category).length }))
const intro = [
  '# 剩余词库的低频词审核', '',
  `当前应用词库 **${bundle.words.length} 词**（已删除确认的 200 个基础词）。原字段词频 ≤2 的 **${low.length} 词**全部纳入统计，再人工挑选其中 **${selected.length} 词**作为偏专业、偏书面或较细分的候选。`, '',
  '## 统计口径', '',
  '- 词频来自已固定的 NETEMVocabulary 数据：作者使用四六级、考研、专四专八约 200 套试卷的混合文本，并做词形还原。不是专门统计考研真题，更不是出现概率或每年考查次数。',
  '- 0 表示原字段为 0；不能保证历年考研从未出现。词形还原、拼写变体、短语分词等可能影响统计，目前没有原始计数流程证据来逐词确认原因。',
  '- 按原字段升序，并在同频时按字母排序。采用 ≤2 的完整分组，不随意截断同频词。',
  '- “偏难/专业”是人工审核标签，不是官方难度等级；专业背景不同，熟悉程度会不同，例如医学相关学生可能熟悉医学词。',
  '- 中文释义原样保留；本次发现的明显释义疑点另作标注，不把它们当作已核对的背诵答案。',
  '- 本次仅生成候选与报告，没有删除或修改应用词库、原始词库、456 词清单或原 200 词清单。', '',
  '## 频数统计', '', '| 原词频字段 | 当前词库中数量 | 人工候选中数量 |', '| ---: | ---: | ---: |',
  ...distribution.map(row => `| ${row.frequency} | ${row.total} | ${row.selected} |`),
  `| 合计 | ${low.length} | ${selected.length} |`, '',
  '## 候选分类', '', '| 人工分类 | 数量 |', '| --- | ---: |', ...totals.map(row => `| ${row.category} | ${row.count} |`), '',
  '## 低频但不按偏难词处理的例子', '',
  'data、means、media、species、statistics、underlying 等原字段也是 0；月份、clothes、yours 等也有 0 记录。本次没有因为字段为 0 就把它们列为偏难删除候选。', '',
  '目前的候选适合讨论是否降低优先级，不意味着建议全部删除。qualitative、variance、configuration 等学术词仍可能对阅读有用。', '',
  '## 人工候选完整列表', '',
  '| 序号 | 单词 | 原词库中文释义 | 原词频 | 人工分类 | 审核提示 | 决定 |',
  '| ---: | --- | --- | ---: | --- | --- | --- |',
]
const esc = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
selected.forEach((word, i) => intro.push(`| ${i + 1} | ${esc(word.spelling)} | ${esc(word.meaning)} | ${word.frequency} | ${word.reviewCategory} | ${esc(word.reviewNote)} | |`))
intro.push('', '## 来源', '', `来源：[exam-data/NETEMVocabulary](${bundle.source.repository})；固定提交 ${bundle.source.commit}。应用版本：${bundle.contentVersion}。数据许可为 CC BY-NC-SA 4.0，完整许可见 data/upstream/LICENSE。`, '')
const appendix = ['# 词频最低的完整 447 词（原字段 ≤2）', '', '原字段统计结果，不是“447 个难偏怪词”。计数方法、来源限制见同目录的低频偏难词候选清单。正式词库未改变。', '', '| 序号 | 单词 | 原词库中文释义 | 原词频 | 入选人工偏难候选 |', '| ---: | --- | --- | ---: | --- |']
low.forEach((word, i) => appendix.push(`| ${i + 1} | ${esc(word.spelling)} | ${esc(word.meaning)} | ${word.frequency} | ${seen.has(word.spelling) ? '是' : '否'} |`))
appendix.push('', `数据来源：[exam-data/NETEMVocabulary](${bundle.source.repository})；${bundle.source.license}。`, '')
await mkdir(at('data/review/'), { recursive: true })
await writeFile(at('data/review/低频偏难词候选清单.md'), intro.join('\n'))
await writeFile(at('data/review/最低频447词完整统计.md'), appendix.join('\n'))
await writeFile(at('data/review/low-frequency-candidates.json'), JSON.stringify({
  sourceCommit: bundle.source.commit, contentVersion: bundle.contentVersion, currentWordCount: bundle.words.length,
  maxSourceFrequency: 2, lowFrequencyCount: low.length, candidateCount: selected.length, distribution, categories: totals,
  purpose: '人工复核候选，未授权删除；不是考研独立语料词频，也不是官方难度等级。', words: selected,
}, null, 2) + '\n')
const after = await Promise.all(protectedFiles.map(hash))
if (before.some((value, i) => value !== after[i])) throw new Error('原始或应用数据意外变化')
console.log(JSON.stringify({ current: bundle.words.length, low: low.length, candidates: selected.length, distribution, categories: totals, protectedFilesUnchanged: true }, null, 2))
