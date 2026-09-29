import type { ValidationIssue, ValidationReport, VocabularyWord } from './types.ts'

const SOURCE_KEY = '四六级词汇词频排序表'
const EXPECTED_COUNT = 5278

export function cetWordId(spelling: string) {
  return `cet:${encodeURIComponent(spelling.normalize('NFC').trim())}`
}

export function validateCetVocabulary(input: unknown): {
  words: VocabularyWord[]
  sixLevelIds: Set<string>
  report: ValidationReport
} {
  const issues: ValidationIssue[] = []
  const words: VocabularyWord[] = []
  const sixLevelIds = new Set<string>()
  const exact = new Set<string>()
  const folded = new Map<string, string>()
  const orders = new Set<number>()
  const issue = (severity: ValidationIssue['severity'], code: string, row: number | null, word: string | null, message: string) =>
    issues.push({ severity, code, row, word, message })
  const candidate = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)[SOURCE_KEY] : undefined
  const rows: unknown[] = Array.isArray(candidate) ? candidate : []
  if (!Array.isArray(candidate)) issue('error', 'INVALID_ROOT', null, null, '四六级原表结构不正确')
  if (rows.length !== EXPECTED_COUNT) issue('error', 'COUNT_MISMATCH', null, null, `预期 ${EXPECTED_COUNT} 条，实际 ${rows.length} 条`)

  rows.forEach((entry, index) => {
    const row = index + 1
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issue('error', 'INVALID_ROW', row, null, '词条必须是对象')
      return
    }
    const item = entry as Record<string, unknown>
    const spelling = typeof item['单词'] === 'string' ? item['单词'].normalize('NFC').trim() : ''
    const meaning = typeof item['释义'] === 'string' ? item['释义'].trim() : ''
    const before = issues.filter(item => item.severity === 'error').length
    if (!spelling) issue('error', 'EMPTY_WORD', row, null, '缺少英文单词')
    if (!meaning) issue('error', 'EMPTY_MEANING', row, spelling, '缺少中文释义')
    if (spelling && exact.has(spelling)) issue('error', 'DUPLICATE_WORD', row, spelling, '重复英文单词')
    if (spelling) {
      exact.add(spelling)
      const previous = folded.get(spelling.toLocaleLowerCase('en-US'))
      if (previous && previous !== spelling) issue('warning', 'CASE_VARIANT', row, spelling, `与 ${previous} 仅大小写不同`)
      folded.set(spelling.toLocaleLowerCase('en-US'), spelling)
    }
    const order = item['序号']
    if (!Number.isInteger(order) || (order as number) < 1 || orders.has(order as number)) issue('error', 'INVALID_ORDER', row, spelling, '原始序号无效或重复')
    else orders.add(order as number)
    const frequency = item['词频']
    if (!Number.isInteger(frequency) || (frequency as number) < 0) issue('error', 'INVALID_FREQUENCY', row, spelling, '词频必须是非负整数')
    const sixLevel = item['六级']
    if (sixLevel !== null && sixLevel !== '★') issue('error', 'INVALID_LEVEL', row, spelling, '六级标记必须是 ★ 或 null')
    for (const key of ['其他拼写', '分类', '子分类']) {
      if (item[key] !== null && typeof item[key] !== 'string') issue('error', 'INVALID_OPTIONAL_FIELD', row, spelling, `${key} 必须是字符串或 null`)
    }
    if (meaning && !/[\u3400-\u9fff]/u.test(meaning)) issue('warning', 'NO_CHINESE', row, spelling, '释义未包含中文')
    if (/[\u0000-\u001f\ufffd]/u.test(spelling + meaning)) issue('error', 'INVALID_TEXT', row, spelling, '词条包含控制符或乱码替代字符')
    if (issues.filter(item => item.severity === 'error').length > before) return
    const id = cetWordId(spelling)
    words.push({
      id, spelling, meaning,
      sourceOrder: order as number, frequency: frequency as number,
      alternateSpelling: item['其他拼写'] as string | null,
      category: item['分类'] as string | null,
      subcategory: item['子分类'] as string | null,
    })
    if (sixLevel === '★') sixLevelIds.add(id)
  })

  return {
    words,
    sixLevelIds,
    report: {
      sourceCount: rows.length,
      importedCount: words.length,
      uniqueCount: exact.size,
      emptyMeaningCount: issues.filter(item => item.code === 'EMPTY_MEANING').length,
      duplicateCount: issues.filter(item => item.code === 'DUPLICATE_WORD').length,
      errorCount: issues.filter(item => item.severity === 'error').length,
      warningCount: issues.filter(item => item.severity === 'warning').length,
      issues,
    },
  }
}
