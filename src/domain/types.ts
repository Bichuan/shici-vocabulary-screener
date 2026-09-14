export interface VocabularyWord {
  /** Stable within this dictionary, derived from normalized spelling, never list position. */
  id: string
  spelling: string
  meaning: string
  sourceOrder: number
  frequency: number
  alternateSpelling: string | null
  category: string | null
  subcategory: string | null
}

export interface VocabularySource {
  repository: string
  commit: string
  fetchedAt: string
  sourceUrl: string
  sha256: string
  syllabusYear: number
  license: string
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  row: number | null
  word: string | null
  message: string
}

export interface ValidationReport {
  sourceCount: number
  excludedCount?: number
  importedCount: number
  uniqueCount: number
  emptyMeaningCount: number
  duplicateCount: number
  errorCount: number
  warningCount: number
  issues: ValidationIssue[]
}

export interface VocabularyBundle {
  schemaVersion: 1
  contentVersion: string
  dictionaryId: string
  title: string
  source: VocabularySource
  report: ValidationReport
  words: VocabularyWord[]
}

// Answering is implemented on Day 3; durable tasks and review state follow later.
export type AnswerResult = 'correct' | 'wrong'

export interface AnswerRecord {
  id: string
  taskId: string
  wordId: string
  dictionaryVersion: string
  questionVersion: string
  selectedOptionId: string
  result: AnswerResult
  answeredAt: string
}

export interface WordLearningState {
  wordId: string
  firstResult: AnswerResult
  latestResult: AnswerResult
  everWrong: boolean
  needsReview: boolean
}

export interface ScreeningTask {
  id: string
  dictionaryVersion: string
  kind: 'initial' | 'review'
  wordIds: string[]
  completedWordIds: string[]
  currentWordId: string | null
  status: 'active' | 'completed'
}
