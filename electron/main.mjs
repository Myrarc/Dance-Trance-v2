import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMediaStorage } from './media-storage.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')

protocol.registerSchemesAsPrivileged([{ scheme: 'dance-trance', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, serviceWorkers: true } }])

app.whenReady().then(async () => {
  const storage = createMediaStorage(join(app.getPath('documents'), 'Dance Trance'))
  await storage.initialize()
  protocol.handle('dance-trance', (request) => {
    const url = new URL(request.url)
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const resolved = normalize(join(dist, requested))
    if (relative(dist, resolved).startsWith('..')) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(resolved).toString())
  })
  ipcMain.handle('media:save-song', (_event, input) => storage.saveSong(input))
  ipcMain.handle('media:read-song', (_event, id) => storage.readSong(id))
  ipcMain.handle('media:delete-song', (_event, id) => storage.deleteSong(id))
  ipcMain.handle('media:save-photo', (_event, input) => storage.savePhoto(input))
  ipcMain.handle('media:read-photo', (_event, id) => storage.readPhoto(id))
  ipcMain.handle('media:delete-photo', (_event, id) => storage.deletePhoto(id))
  ipcMain.handle('media:folders', () => storage.folders)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents.getURL().startsWith('dance-trance://app/') && permission === 'media')
  })
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#fff4d8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('dance-trance://app/')) event.preventDefault()
  })
  await window.loadURL('dance-trance://app/index.html')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
