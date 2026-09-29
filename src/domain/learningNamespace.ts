export type LearningDictionaryId = 'netem-2024' | 'cet6-2016-curated'

export function learningKeys(dictionaryId: LearningDictionaryId) {
  if (dictionaryId === 'netem-2024') return {
    initial: 'initial-screening',
    review: 'review-history',
    beforeRestore: 'before-restore',
    generation: 'storage-generation',
  }
  if (dictionaryId === 'cet6-2016-curated') return {
    initial: 'cet6:initial-screening',
    review: 'cet6:review-history',
    beforeRestore: 'cet6:before-restore',
    generation: 'cet6:storage-generation',
  }
  throw new Error('无法识别当前词库，学习记录未更改。')
}

export function dictionaryLabel(dictionaryId: LearningDictionaryId) {
  return dictionaryId === 'netem-2024' ? '考研' : '六级'
}
