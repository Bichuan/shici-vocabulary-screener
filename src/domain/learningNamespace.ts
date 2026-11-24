const dictionaryNames = {
  'netem-2024': '考研',
  'cet6-2016-curated': '六级',
  'ielts-ecdict': '雅思',
} as const

export type LearningDictionaryId = keyof typeof dictionaryNames

export function learningKeys(dictionaryId: LearningDictionaryId) {
  if (dictionaryId === 'netem-2024') return {
    initial: 'initial-screening',
    review: 'review-history',
    beforeRestore: 'before-restore',
    generation: 'storage-generation',
  }
  const prefix = dictionaryId === 'cet6-2016-curated' ? 'cet6:' : dictionaryId === 'ielts-ecdict' ? 'ielts:' : null
  if (!prefix) throw new Error('无法识别当前词库，学习记录未更改。')
  return {
    initial: prefix + 'initial-screening',
    review: prefix + 'review-history',
    beforeRestore: prefix + 'before-restore',
    generation: prefix + 'storage-generation',
  }
}

export function dictionaryLabel(dictionaryId: LearningDictionaryId) {
  return dictionaryNames[dictionaryId]
}
