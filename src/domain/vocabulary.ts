import type { ValidationIssue, ValidationReport, VocabularyWord } from './types.ts'

const SOURCE_KEY = '5530考研词汇词频排序表'
const normalizeSpelling = (value: string) => value.normalize('NFC').trim()

/** Case is significant: May and may have different meanings in this dictionary. */
export function wordId(spelling: string): string {
  return `netem:${encodeURIComponent(normalizeSpelling(spelling))}`
}

export function validateVocabulary(input: unknown, expectedCount = 5530): {
  words: VocabularyWord[]
  report: ValidationReport
} {
  const issues: ValidationIssue[] = []
  const words: VocabularyWord[] = []
  const exact = new Set<string>()
  const folded = new Map<string, string>()
  const orders = new Set<number>()
  const issue = (severity: ValidationIssue['severity'], code: string, row: number | null, word: string | null, message: string) =>
    issues.push({ severity, code, row, word, message })
  const candidate = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)[SOURCE_KEY] : undefined
  const rows: unknown[] = Array.isArray(candidate) ? candidate : []
  if (!Array.isArray(candidate)) issue('error', 'INVALID_ROOT', null, null, '词库根结构或词表名称不正确')
  if (rows.length !== expectedCount) issue('error', 'COUNT_MISMATCH', null, null, `预期 ${expectedCount} 条，实际 ${rows.length} 条`)

  rows.forEach((entry, index) => {
    const row = index + 1
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issue('error', 'INVALID_ROW', row, null, '词条必须是对象')
      return
    }
    const item = entry as Record<string, unknown>
    const spelling = typeof item['单词'] === 'string' ? normalizeSpelling(item['单词']) : ''
    const meaning = typeof item['释义'] === 'string' ? item['释义'].trim() : ''
    const priorErrors = issues.filter(i => i.severity === 'error').length
    if (!spelling) issue('error', 'EMPTY_WORD', row, null, '缺少英文单词')
    if (!meaning) issue('error', 'EMPTY_MEANING', row, spelling, '缺少中文释义')
    if (spelling && exact.has(spelling)) issue('error', 'DUPLICATE_WORD', row, spelling, '同一拼写出现多次，需审核后再导入')
    if (spelling) {
      exact.add(spelling)
      const previous = folded.get(spelling.toLowerCase())
      if (previous && previous !== spelling) issue('warning', 'CASE_VARIANT', row, spelling, `与 ${previous} 仅大小写不同；保留为独立词条`)
      folded.set(spelling.toLowerCase(), spelling)
    }
    const order = item['序号']
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 1 || orders.has(order)) {
      issue('error', 'INVALID_ORDER', row, spelling, '原始序号无效或重复')
    } else orders.add(order)
    const frequency = item['词频']
    if (typeof frequency !== 'number' || !Number.isInteger(frequency) || frequency < 0) issue('error', 'INVALID_FREQUENCY', row, spelling, '词频必须是非负整数')
    for (const key of ['其他拼写', '分类', '子分类']) {
      if (item[key] !== null && typeof item[key] !== 'string') issue('error', 'INVALID_OPTIONAL_FIELD', row, spelling, `${key} 必须是字符串或 null`)
    }
    if (meaning && !/[\u3400-\u9fff]/u.test(meaning)) issue('warning', 'NO_CHINESE', row, spelling, '释义未包含中文，需要人工检查')
    if (/[\u0000-\u001f\ufffd]/u.test(spelling + meaning)) issue('error', 'INVALID_TEXT', row, spelling, '词条包含控制符或乱码替代字符')
    if (issues.filter(i => i.severity === 'error').length > priorErrors) return
    words.push({
      id: wordId(spelling), spelling, meaning,
      sourceOrder: order as number, frequency: frequency as number,
      alternateSpelling: item['其他拼写'] as string | null,
      category: item['分类'] as string | null,
      subcategory: item['子分类'] as string | null,
    })
  })
  return {
    words,
    report: {
      sourceCount: rows.length,
      importedCount: words.length,
      uniqueCount: exact.size,
      emptyMeaningCount: issues.filter(i => i.code === 'EMPTY_MEANING').length,
      duplicateCount: issues.filter(i => i.code === 'DUPLICATE_WORD').length,
      errorCount: issues.filter(i => i.severity === 'error').length,
      warningCount: issues.filter(i => i.severity === 'warning').length,
      issues,
    },
  }
}
