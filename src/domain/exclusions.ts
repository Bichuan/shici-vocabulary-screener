import type { VocabularyWord } from './types.ts'

/** Fail closed if the approved list changes or no longer matches the source dictionary. */
export function excludeApprovedWords(words: VocabularyWord[], ids: string[], expectedCount: number): VocabularyWord[] {
  const excluded = new Set(ids)
  if (ids.length !== expectedCount || excluded.size !== expectedCount) throw new Error('排除清单数量错误或存在重复 ID')
  const known = new Set(words.map(word => word.id))
  if (ids.some(id => !known.has(id))) throw new Error('排除清单含词库中不存在的 ID')
  return words.filter(word => !excluded.has(word.id))
}
