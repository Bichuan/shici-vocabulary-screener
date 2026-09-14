// 第一天至第七天体验版的历史顺序，仅用于把既有 48 题进度迁移到全量题库。
// 其中的旧释义不再参与出题；当前全部选项统一读取原始词表。
export const sampleGroups = [
  { partOfSpeech: 'v.', entries: [
    ['abandon', '放弃'], ['absorb', '吸收'], ['abolish', '废除'], ['accelerate', '加速'],
    ['accumulate', '积累'], ['adapt', '适应'], ['admire', '钦佩'], ['admit', '承认'],
  ] },
  { partOfSpeech: 'v.', entries: [
    ['allocate', '分配'], ['anticipate', '预期'], ['assemble', '装配'], ['assess', '评估'],
    ['attach', '附上'], ['attain', '达到'], ['betray', '背叛'], ['calculate', '计算'],
  ] },
  { partOfSpeech: 'v.', entries: [
    ['preserve', '保存'], ['convince', '使信服'], ['cooperate', '合作'], ['decline', '拒绝'],
    ['define', '定义'], ['detect', '发现'], ['distinguish', '区别'], ['eliminate', '排除'],
  ] },
  { partOfSpeech: 'n.', entries: [
    ['ambition', '雄心'], ['barrier', '障碍'], ['budget', '预算'], ['catastrophe', '大灾难'],
    ['economy', '经济'], ['climate', '气候'], ['consequence', '后果'], ['controversy', '争论'],
  ] },
  { partOfSpeech: 'n.', entries: [
    ['discipline', '纪律'], ['evidence', '证据'], ['foundation', '基础'], ['hypothesis', '假设'],
    ['industry', '工业'], ['institution', '机构'], ['obligation', '义务'], ['priority', '优先'],
  ] },
  { partOfSpeech: 'adj.', entries: [
    ['abstract', '抽象的'], ['accurate', '精确的'], ['artificial', '人造的'], ['cautious', '谨慎的'],
    ['complex', '复杂的'], ['crucial', '关键的'], ['domestic', '家庭的'], ['efficient', '高效的'],
  ] },
] as const
