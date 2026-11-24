import { devices, expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { buildQuestions } from '../src/domain/questions.ts'
import { questionSignature } from '../src/domain/screeningStorage.ts'
import type { VocabularyBundle } from '../src/domain/types.ts'

const ielts = JSON.parse(readFileSync('public/data/ielts-vocabulary.json', 'utf8')) as VocabularyBundle

test('雅思资源暂不可用时可切回旧词库，重试后可正常筛查', async ({ page }) => {
  const file = '**/data/ielts-vocabulary.json'
  await page.route(file, route => route.fulfill({ status: 404 }))
  await page.goto('/#screening')
  await expect(page.locator('.screening-progress')).toContainText('0 / 5220 词')
  await page.getByRole('button', { name: '雅思词汇' }).click()
  await expect(page.getByRole('alert')).toContainText('雅思词库暂时无法读取')
  await page.getByRole('button', { name: '六级词汇' }).click()
  await expect(page.locator('.home-progress-card')).toContainText('0 / 4,719 词')
  await page.getByRole('button', { name: '雅思词汇' }).click()
  await expect(page.getByRole('alert')).toContainText('雅思词库暂时无法读取')
  await page.unroute(file)
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('.home-progress-card')).toContainText(ielts.words.length.toLocaleString('en-US'))
})

test('雅思三轮复筛后，导出和打印仅包含仍答错的词', async ({ page }) => {
  const words = ielts.words.slice(250, 266)
  const questions = buildQuestions(words, () => 0.5, false)
  const version = ielts.contentVersion
  const taskId = 'ielts-test-screening'
  const records = questions.map((question, index) => {
    const wrong = index < 4
    const option = question.options[wrong ? 1 : 0]!
    return {
      id: question.id, taskId, wordId: question.wordId, dictionaryVersion: version,
      questionVersion: question.version, selectedOptionId: option.id, result: wrong ? 'wrong' : 'correct',
      answeredAt: '2026-11-24T00:00:00.000Z', spelling: question.spelling,
      coreMeaning: question.coreMeaning, selectedMeaning: option.text,
    }
  })
  await page.addInitScript(() => localStorage.setItem('shici-selected-dictionary', 'ielts'))
  await page.route('**/data/ielts-vocabulary.json', route => route.fulfill({
    json: { ...ielts, words, report: { ...ielts.report, importedCount: words.length } },
  }))
  await page.goto('/#review-tools')
  const backup = {
    schemaVersion: 1, createdAt: '2026-11-24T00:00:00.000Z', dictionaryId: ielts.dictionaryId, dictionaryVersion: version,
    initial: { schemaVersion: 1, taskId, revision: records.length, dictionaryVersion: version, questionSignature: questionSignature(questions), records },
    review: null,
  }
  await page.getByLabel('选择学习记录备份文件').setInputFiles({
    name: 'ielts-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  })
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  const card = page.locator('.question-card:visible')
  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: '开始错词复筛' }).click()
    for (const [index, question] of questions.slice(round, 4).entries()) {
      await expect(card.getByRole('heading', { name: question.spelling, exact: true })).toBeVisible()
      await card.getByText(question.options[index === 0 ? 0 : 1]!.text, { exact: true }).click()
    }
    await page.getByRole('button', { name: '查看复筛结果' }).click()
  }
  await expect(page.getByRole('button', { name: '历史错词（4）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '当前仍不会的词（1）' }).click()
  await expect(page.locator('.study-tools')).toContainText('已完成第 3 轮复筛')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 Excel CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toContain('雅思-当前仍不会')
  const csv = readFileSync((await file.path())!, 'utf8').trimEnd().split('\r\n')
  expect(csv).toHaveLength(2)
  expect(csv[1]).toContain(`"${questions[3]!.spelling}"`)
  await page.getByRole('link', { name: '打印背诵表' }).click()
  await expect(page.getByRole('heading', { name: '雅思当前仍不会的词背诵表' })).toBeVisible()
  await expect(page.locator('.memorization-pair')).toHaveCount(1)
  await expect(page.locator('.memorization-pair')).toContainText(questions[3]!.spelling)
})

test.describe('安卓 Chrome 移动布局', () => {
  const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7']
  test.use({ ...pixel, serviceWorkers: 'allow' })

  test('缓存就绪后可离线打开三套词库，离线作答可续筛和备份', async ({ page, context }, testInfo) => {
    await page.addInitScript(() => { Math.random = () => 0.5 })
    await page.goto('/')
    await page.getByText('添加到安卓主屏幕', { exact: true }).click()
    await expect(page.locator('.install-guide[open]')).toContainText('Chrome')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await context.setOffline(true)
    await page.goto('/?offline=android')

    for (const [label, count] of [['考研词汇', '5,220'], ['六级词汇', '4,719'], ['雅思词汇', ielts.words.length.toLocaleString('en-US')]]) {
      await page.getByRole('button', { name: label }).click()
      await expect(page.locator('.home-progress-card')).toContainText(count!)
    }
    await page.goto('/?offline=android#screening')
    const card = page.locator('.question-card:visible')
    const question = buildQuestions(ielts.words, () => 0.5)[0]!
    await expect(card.getByRole('heading', { name: question.spelling, exact: true })).toBeVisible()
    await expect(card.locator('.answer-option')).toHaveCount(8)
    await card.getByText(question.options[1]!.text, { exact: true }).click()
    await expect(card.locator('.answer-feedback')).toContainText(question.coreMeaning)
    await page.reload()
    await expect(page.locator('.screening-progress')).toContainText(`已筛选 1 / ${ielts.words.length} 词`)
    await page.goto('/?offline=android#review-tools')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '备份学习记录' }).click()
    const path = testInfo.outputPath('android-ielts-backup.json')
    await (await download).saveAs(path)
    const backup = JSON.parse(readFileSync(path, 'utf8'))
    expect(backup).toMatchObject({ dictionaryId: ielts.dictionaryId, initial: { revision: 1 } })
    expect(backup.initial.records[0].result).toBe('wrong')
    await page.getByLabel('选择学习记录备份文件').setInputFiles(path)
    await expect(page.getByRole('region', { name: '确认恢复备份' })).toBeVisible()
    await page.getByRole('button', { name: '确认恢复', exact: true }).click()
    await expect(page.locator('.review-overview')).toContainText('已筛选 1 词')
  })
})
