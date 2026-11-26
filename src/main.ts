import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { retryUsageReport, usageReportingEnabled } from './domain/usageStats.ts'

createApp(App).mount('#app')
window.dispatchEvent(new Event('shici-ready'))
if (usageReportingEnabled) {
  void retryUsageReport()
  window.addEventListener('online', () => { void retryUsageReport() })
}

async function registerOfflineWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !['http:', 'https:'].includes(location.protocol)) return
  const scope = new URL(import.meta.env.BASE_URL, location.href)
  try {
    const registration = await navigator.serviceWorker.register(new URL('service-worker.js', scope), {
      scope: scope.href,
      updateViaCache: 'none',
    })
    await registration.update()
  } catch (error) {
    console.error('离线缓存暂时无法启用：', error)
  }
}

window.addEventListener('load', () => { void registerOfflineWorker() })
