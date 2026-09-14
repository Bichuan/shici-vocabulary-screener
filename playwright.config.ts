import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    launchOptions: {
      executablePath: process.env.TEST_BROWSER_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
})
