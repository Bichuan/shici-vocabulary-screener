import { expect, test } from '@playwright/test'

test('404 页可以返回首页，反馈信息仅包含访问路径', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/missing/deep/link?**', route => route.fulfill({
    status: 404,
    contentType: 'text/html; charset=utf-8',
    path: 'dist/404.html',
  }))
  await page.setViewportSize({ width: 320, height: 700 })
  const response = await page.goto('/missing/deep/link?query=private#fragment')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: '找不到这个页面' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回拾词首页' })).toHaveAttribute('href', '/shici-vocabulary-screener/')
  await page.getByText('反馈 404 问题', { exact: true }).click()
  const report = page.getByLabel('反馈信息（可补充）')
  await expect(report).toHaveValue(/访问路径：\/missing\/deep\/link\n时间（UTC）：/)
  const draft = await report.inputValue()
  expect(draft).not.toContain('private')
  expect(draft).not.toContain('fragment')
  await report.fill(draft + ' 从聊天软件打开。')
  await page.getByRole('button', { name: '复制反馈信息' }).click()
  await expect(page.getByRole('status')).toHaveText('已复制反馈信息。')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replaceAll('\r\n', '\n')).toBe(await report.inputValue())

  const link = await page.getByRole('link', { name: '在 GitHub 反馈' }).getAttribute('href')
  const issue = new URL(link!)
  expect(issue.origin + issue.pathname).toBe('https://github.com/Bichuan/shici-vocabulary-screener/issues/new')
  expect(issue.searchParams.get('body')).toBe(await report.inputValue())
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})
