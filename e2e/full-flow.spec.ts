import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { buildSampleQuestions } from '../src/domain/questions.ts'
import type { VocabularyBundle } from '../src/domain/types.ts'
import { questionSignature } from '../src/domain/screeningStorage.ts'

const fullBundle = JSON.parse(readFileSync('public/data/vocabulary.json', 'utf8')) as VocabularyBundle
const fullQuestions = buildSampleQuestions(fullBundle.words, () => 0.999999, false)
const testWordIds = new Set(fullQuestions.slice(0, 48).map(question => question.wordId))
const testWords = fullBundle.words.filter(word => testWordIds.has(word.id))
const bundle: VocabularyBundle = { ...fullBundle, words: testWords, report: { ...fullBundle.report, importedCount: testWords.length } }
const questions = buildSampleQuestions(bundle.words, () => 0.999999, true)
const card = (page: Page) => page.locator('.question-card:visible')
async function useTestVocabulary(page: Page) {
  await page.addInitScript(() => { Math.random = () => 0.999999 })
  await page.route('**/data/vocabulary.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(bundle) }))
}
async function answer(page: Page, index: number, correct = true) {
  const q = questions[index]!
  await expect(card(page).getByRole('heading', { name: q.spelling, exact: true })).toBeVisible()
  const text = correct ? q.coreMeaning : q.options.find(o => o.text !== q.coreMeaning)!.text
  await card(page).getByRole('button').filter({ has: page.getByText(text, { exact: true }) }).click()
  await expect(card(page).locator('.answer-feedback')).toContainText(`${q.spelling} → ${q.coreMeaning}`)
  await expect(card(page).getByRole('button').first()).toBeDisabled()
  await expect(page.locator('.answer-feedback:visible strong')).toHaveCount(0, { timeout: 5000 })
}

test('PWA 外壳声明独立启动、竖屏策略、图标和安装说明', async ({ page, request }, testInfo) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({
    id: './',
    name: '拾词 · 考研英语词汇筛查器',
    short_name: '拾词',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f6f7f2',
    theme_color: '#285b46',
  })
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: 'icons/pwa-192.png', sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ src: 'icons/pwa-512.png', sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ src: 'icons/pwa-maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
  ]))

  await useTestVocabulary(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#285b46')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '拾词')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/)
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180')

  const iconSizes = await page.evaluate(async () => {
    const load = (path: string) => new Promise<[number, number]>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight])
      image.onerror = () => reject(new Error('图标无法加载'))
      image.src = path
    })
    return {
      apple: await load('./icons/apple-touch-icon.png'),
      regular: await load('./icons/pwa-192.png'),
      maskable: await load('./icons/pwa-maskable-512.png'),
    }
  })
  expect(iconSizes).toEqual({ apple: [180, 180], regular: [192, 192], maskable: [512, 512] })

  const guide = page.locator('.install-guide')
  await expect(guide).toBeVisible()
  await guide.locator('summary').click()
  await expect(guide.locator('li')).toHaveCount(4)
  await expect(guide).toContainText('Safari')
  await expect(guide).toContainText('分享按钮')
  await expect(guide).toContainText('添加到主屏幕')
  await expect(guide).toContainText('竖屏优先')
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath('pwa-install-guide.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('iPhone 首页显示进度、四个入口和安全区底部导航', async ({ page }, testInfo) => {
  await useTestVocabulary(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '从这里继续筛查。' })).toBeVisible()
    await expect(page.locator('.home-actions a')).toHaveCount(4)
    await expect(page.locator('.home-progress-card strong')).toContainText('0 / 48 词')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }

  await page.locator('.home-action-primary').click()
  await expect(page).toHaveURL(/#screening$/)
  await expect(card(page)).toBeVisible()
  await answer(page, 0, false)

  await page.getByRole('navigation', { name: '移动端导航' }).getByRole('link', { name: /首页/ }).click()
  await expect(page.locator('.home-progress-card strong')).toContainText('1 / 48 词')
  await expect(page.getByRole('link', { name: /错词复筛/ })).toContainText('历史错词 1 个')

  await page.getByRole('link', { name: /备份与恢复/ }).click()
  await expect(page).toHaveURL(/#review-tools$/)
  await expect(page.locator('#review-tools')).toBeVisible()
  await page.goto('/')
  await page.screenshot({ path: testInfo.outputPath('mobile-home.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})


test('iPhone 八选一保持两列四行、长释义换行并自动保存切题', async ({ page }, testInfo) => {
  await useTestVocabulary(page)

  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#screening')
    await expect(card(page)).toBeVisible()
    await expect(card(page).locator('.target-word > span')).toHaveCount(0)
    await expect(card(page).locator('.answer-option')).toHaveCount(8)
    const layout = await card(page).locator('.answer-option').evaluateAll(buttons => {
      const rects = buttons.map(button => button.getBoundingClientRect())
      return {
        columns: new Set(rects.map(rect => Math.round(rect.left))).size,
        rows: new Set(rects.map(rect => Math.round(rect.top))).size,
        minHeight: Math.min(...rects.map(rect => rect.height)),
      }
    })
    expect(layout.columns).toBe(2)
    expect(layout.rows).toBe(4)
    expect(layout.minHeight).toBeGreaterThanOrEqual(58)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  const longText = '这是一个用于检查手机按钮自动换行且不会撑破两列布局的较长核心释义'
  const meaning = card(page).locator('.answer-option').first().locator('span').nth(1)
  const originalText = await meaning.textContent()
  await meaning.evaluate((element, text) => { element.textContent = text }, longText)
  const longLayout = await card(page).locator('.answer-option').first().evaluate(button => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
    height: button.getBoundingClientRect().height,
  }))
  expect(longLayout.scrollWidth).toBeLessThanOrEqual(longLayout.clientWidth)
  expect(longLayout.height).toBeGreaterThanOrEqual(60)
  await meaning.evaluate((element, text) => { element.textContent = text }, originalText)

  const first = questions[0]!
  const firstWrong = first.options.find(option => option.id !== first.correctOptionId)!
  await card(page).getByRole('button').filter({ has: page.getByText(firstWrong.text, { exact: true }) }).click()
  await expect(card(page).locator('.answer-option.is-correct')).toContainText(first.coreMeaning)
  await page.waitForTimeout(700)
  await expect(card(page).getByRole('heading', { name: first.spelling, exact: true })).toBeVisible()
  await expect(card(page).getByRole('heading', { name: questions[1]!.spelling, exact: true })).toBeVisible({ timeout: 2000 })

  const second = questions[1]!
  await card(page).getByRole('button').filter({ has: page.getByText(second.coreMeaning, { exact: true }) }).click()
  await expect(card(page).locator('.answer-feedback')).toContainText(second.coreMeaning)
  await page.reload()
  await expect(card(page).getByRole('heading', { name: questions[2]!.spelling, exact: true })).toBeVisible()
  await expect(page.locator('.screening-progress')).toContainText('已筛选 2 / 48 词')
  await page.screenshot({ path: testInfo.outputPath('mobile-screening.png'), fullPage: true })
})

test('完整初筛、复筛、CSV、打印、备份恢复及窄屏布局', async ({ page }, testInfo) => {
  await useTestVocabulary(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#print')
  await expect(page.getByRole('heading', { name: '暂无历史错词' })).toBeVisible()
  await page.getByRole('button', { name: '返回错词列表' }).click()
  await expect(page).toHaveURL(/#review$/)
  await expect(page.getByRole('button', { name: '开始错词复筛' })).toBeDisabled()

  await page.goto('/#screening')
  await answer(page, 0, false)
  await page.goto('/#review')
  const partialDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份学习记录' }).click()
  const partial = await partialDownload
  const partialPath = testInfo.outputPath('partial-backup.json')
  await partial.saveAs(partialPath)
  expect(JSON.parse(readFileSync(partialPath, 'utf8')).review).toBeNull()

  await page.getByRole('link', { name: '打印背诵表', exact: true }).click()
  await expect(page.locator('.print-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '返回错词列表' }).click()
  await page.goto('/#screening')
  await expect(card(page).getByRole('heading', { name: questions[1]!.spelling, exact: true })).toBeVisible()
  await answer(page, 1, false)
  for (let i = 2; i < questions.length; i++) await answer(page, i)
  await expect(page.getByRole('heading', { name: '全部词汇已筛选完成' })).toBeVisible()
  await page.getByRole('link', { name: '查看错词与复筛', exact: true }).click()
  await expect(page.getByRole('button', { name: '待复筛（2）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始错词复筛' }).click()
  await answer(page, 0)
  await page.reload()
  await page.getByRole('button', { name: '继续未完成的复筛' }).click()
  await answer(page, 1, false)
  await page.getByRole('button', { name: '查看复筛结果' }).click()
  await expect(page.getByRole('button', { name: '待复筛（1）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始错词复筛' }).click()
  await answer(page, 1)
  await page.getByRole('button', { name: '查看复筛结果' }).click()
  await expect(page.getByRole('button', { name: '待复筛（0）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '历史错词（2）', exact: true }).click()

  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 Excel CSV' }).click()
  const csvPath = testInfo.outputPath('words.csv')
  await (await csvDownload).saveAs(csvPath)
  expect(readFileSync(csvPath, 'utf8')).toBe(`\uFEFF"序号","英文单词","正确核心义"\r\n"1","${questions[0]!.spelling}","${questions[0]!.coreMeaning}"\r\n"2","${questions[1]!.spelling}","${questions[1]!.coreMeaning}"\r\n`)
  const backupDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份学习记录' }).click()
  const backupPath = testInfo.outputPath('completed-backup.json')
  await (await backupDownload).saveAs(backupPath)

  await page.getByRole('link', { name: '打印背诵表', exact: true }).click()
  await expect(page.locator('.print-table tbody tr')).toHaveCount(2)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.print-actions')).toBeHidden()
  await expect(page.locator('.print-table').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('print-layout.png'), fullPage: true })
  const pdf = await page.pdf({ path: testInfo.outputPath('memorization.pdf'), preferCSSPageSize: true })
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: '返回错词列表' }).click()
  // Restore the actual partial download, then restore the completed download.
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('选择学习记录备份文件').setInputFiles(partialPath)
  await expect(page.locator('.review-overview')).toContainText('已筛选 1 词')
  await expect(page.getByRole('button', { name: '开始错词复筛' })).toBeDisabled()
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('选择学习记录备份文件').setInputFiles(backupPath)
  await expect(page.locator('.review-overview')).toContainText('已筛选 48 词')
  await expect(page.getByRole('button', { name: '待复筛（0）', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('mobile-review.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('键盘作答、取消恢复和无效备份均保护现有进度', async ({ page }) => {
  await useTestVocabulary(page)
  await page.goto('/#screening')
  const correct = card(page).getByRole('button').filter({ has: page.getByText(questions[0]!.coreMeaning, { exact: true }) })
  await expect(correct).toBeEnabled()
  await correct.focus()
  await page.keyboard.press('Enter')
  await expect(card(page).locator('.answer-feedback')).toContainText(`${questions[0]!.spelling} → ${questions[0]!.coreMeaning}`)
  await page.reload()
  await expect(card(page).getByRole('heading', { name: questions[1]!.spelling, exact: true })).toBeVisible()
  await page.goto('/#review')
  const empty = { schemaVersion: 1, createdAt: new Date().toISOString(), dictionaryVersion: bundle.contentVersion, initial: null, review: null }
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByLabel('选择学习记录备份文件').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) })
  await expect(page.locator('.review-overview')).toContainText('已筛选 1 词')
  await page.getByLabel('选择学习记录备份文件').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') })
  await expect(page.locator('.tool-message')).toContainText('备份文件格式不正确')
  await page.reload()
  await expect(page.locator('.review-overview')).toContainText('已筛选 1 词')
})

test('48 词 A4 三栏纵向排列与打印按钮', async ({ page }, testInfo) => {
  await useTestVocabulary(page)
  await page.goto('/#print')
  const taskId = 'isolated-print-fixture'
  const snapshot = {
    schemaVersion: 1, taskId, revision: questions.length, dictionaryVersion: bundle.contentVersion, questionSignature: questionSignature(questions),
    records: questions.map(q => {
      const option = q.options.find(o => o.id !== q.correctOptionId)!
      return { id: q.id, taskId, wordId: q.wordId, dictionaryVersion: bundle.contentVersion, questionVersion: q.version, selectedOptionId: option.id, result: 'wrong', answeredAt: new Date().toISOString(), spelling: q.spelling, coreMeaning: q.coreMeaning, selectedMeaning: option.text }
    }),
  }
  // Seed only this fresh Playwright context; no user profile is attached.
  await page.evaluate(async initial => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('shici-learning', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('sessions')
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('sessions', 'readwrite')
        tx.objectStore('sessions').put(initial, 'initial-screening')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  }, snapshot)
  await page.reload()
  await expect(page.locator('.print-table tbody tr')).toHaveCount(48)
  await expect(page.locator('.print-table')).toHaveCount(3)
  await expect(page.locator('.print-table th')).toHaveCount(0)
  await expect(page.locator('.print-table tbody tr').first().locator('td')).toHaveText([questions[0]!.spelling, questions[0]!.coreMeaning])
  await expect(page.locator('.print-table').nth(0).locator('tbody tr').first()).toContainText(questions[0]!.spelling)
  await expect(page.locator('.print-table').nth(1).locator('tbody tr').first()).toContainText(questions[16]!.spelling)
  await expect(page.locator('.print-table').nth(2).locator('tbody tr').first()).toContainText(questions[32]!.spelling)
  await page.evaluate(() => { window.print = () => { document.body.dataset.printCalled = 'yes' } })
  await page.getByRole('button', { name: '打印 / 保存为 PDF' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'yes')
  await page.setViewportSize({ width: 794, height: 1123 })
  await page.emulateMedia({ media: 'print' })
  await page.screenshot({ path: testInfo.outputPath('a4-layout.png'), fullPage: true })
  const pdf = await page.pdf({ path: testInfo.outputPath('a4-multipage.pdf'), preferCSSPageSize: true })
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1)
})

test('界面缩放按钮、快捷键和本地记忆', async ({ page }) => {
  await useTestVocabulary(page)
  await page.goto('/#screening')
  await expect(page.locator('html')).toHaveAttribute('style', /zoom: 1/)
  await page.getByRole('button', { name: '放大界面' }).click()
  await expect(page.getByRole('button', { name: '恢复默认缩放，当前 110%' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('style', /zoom: 1.1/)
  await page.reload()
  await expect(page.getByRole('button', { name: '恢复默认缩放，当前 110%' })).toBeVisible()
  await page.keyboard.press('Control+0')
  await expect(page.getByRole('button', { name: '恢复默认缩放，当前 100%' })).toBeVisible()
  await page.keyboard.press('Control+-')
  await expect(page.getByRole('button', { name: '恢复默认缩放，当前 90%' })).toBeVisible()
})

test('当前筛查可单独备份、继续使用或确认后重置', async ({ page }, testInfo) => {
  await useTestVocabulary(page)
  await page.goto('/#screening')
  await answer(page, 0, false)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份当前筛查' }).click()
  const backup = await download
  expect(backup.suggestedFilename()).toMatch(/^拾词-筛查备份-1词-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
  const backupPath = testInfo.outputPath('screening-checkpoint.json')
  await backup.saveAs(backupPath)
  expect(JSON.parse(readFileSync(backupPath, 'utf8')).initial.records).toHaveLength(1)
  await expect(page.locator('.screening-action-message')).toContainText('可以继续筛选')
  await expect(page.locator('.screening-progress')).toContainText('已筛选 1 / 48 词')

  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '重置筛查' }).click()
  await expect(page.locator('.screening-progress')).toContainText('已筛选 1 / 48 词')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '重置筛查' }).click()
  await expect(page.locator('.screening-progress')).toContainText('已筛选 0 / 48 词')
  await expect(page.getByRole('button', { name: '备份当前筛查' })).toBeDisabled()
})
