const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{
  scheme: 'shici',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

const applicationRoot = path.resolve(__dirname, '..')
const webRoot = path.join(applicationRoot, 'dist')
const smokeArgument = process.argv.find(value => value.startsWith('--smoke-test='))
const smokeResultPath = smokeArgument ? smokeArgument.slice('--smoke-test='.length) : null

function applicationFile(urlString) {
  const url = new URL(urlString)
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^[/\\]+/, '')
  const target = path.resolve(webRoot, relative)
  if (target !== webRoot && !target.startsWith(`${webRoot}${path.sep}`)) return null
  return target
}

async function runSmokeTest(window) {
  if (!smokeResultPath) return
  try {
    const result = await window.webContents.executeJavaScript(`new Promise(resolve => {
      const startedAt = Date.now()
      const check = () => {
        const body = document.body.innerText
        if (body.includes('5,220') || body.includes('词库暂时无法读取') || Date.now() - startedAt > 10000) {
          resolve({ title: document.title, body, url: location.href, hasIndexedDB: typeof indexedDB !== 'undefined' })
        } else setTimeout(check, 100)
      }
      check()
    })`)
    const passed = result.body.includes('5,220') && result.hasIndexedDB && result.url.startsWith('shici://app/')
    fs.writeFileSync(smokeResultPath, JSON.stringify({ passed, title: result.title, url: result.url, hasIndexedDB: result.hasIndexedDB }, null, 2))
    app.exit(passed ? 0 : 1)
  } catch (error) {
    fs.writeFileSync(smokeResultPath, JSON.stringify({ passed: false, error: String(error) }, null, 2))
    app.exit(1)
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    show: !smokeResultPath,
    backgroundColor: '#f6f7f2',
    icon: path.join(applicationRoot, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('shici://app/')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  window.webContents.once('did-finish-load', () => void runSmokeTest(window))
  void window.loadURL('shici://app/index.html')
  return window
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  let mainWindow = null
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    app.setName('拾词')
    Menu.setApplicationMenu(null)
    protocol.handle('shici', request => {
      const file = applicationFile(request.url)
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
    })
    mainWindow = createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
