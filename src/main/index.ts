import { app, Tray, Menu, nativeImage, session, desktopCapturer, BrowserWindow } from 'electron'
import { join } from 'path'
import { settingsStore } from './settingsStore'
import { secretStore } from './secrets'
import { registerIpc } from './ipc'
import { windows } from './windows'
import { registerHotkeys, watchHotkeys, unregisterHotkeys } from './hotkeys'
import { commands } from './commands'
import { knowledgeStore } from './knowledge/store'

let tray: Tray | null = null

function iconPath(name: string): string {
  // В dev ресурсы лежат в корне репо; в prod — рядом с собранным main (extraResources).
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../resources', name)
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath('tray.png'))
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.setToolTip('Quiet Helper')
  const menu = Menu.buildFromTemplate([
    { label: 'Показать / скрыть оверлей', click: () => commands.toggleOverlay() },
    { label: 'Скриншот экрана → вопрос', click: () => void commands.captureScreenAndAsk() },
    { label: 'Выделить область → вопрос', click: () => commands.captureRegion() },
    { type: 'separator' },
    { label: 'Настройки…', click: () => windows.createSettings() },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => commands.toggleOverlay())
}

/** Разрешаем захват микрофона/системного звука и экрана для рендерера. */
function configureMediaPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'display-capture']
    callback(allowed.includes(permission))
  })
  // Разрешаем getDisplayMedia (для системного звука через loopback как фолбэк).
  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    })
  })
}

// Единственный экземпляр (второй запуск фокусирует настройки).
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => windows.createSettings())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.quiethelper.app')

    settingsStore.init()
    secretStore.init()
    knowledgeStore.init()
    configureMediaPermissions()
    registerIpc()

    windows.createOverlay()
    createTray()
    registerHotkeys()
    watchHotkeys()

    // Если онбординг не пройден — сразу открываем настройки.
    if (!settingsStore.get().onboardingComplete) {
      windows.createSettings()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windows.createOverlay()
    })
  })

  // Приложение живёт в трее — не выходим при закрытии всех окон.
  app.on('window-all-closed', () => {
    // no-op на Windows: остаёмся в трее
  })

  app.on('will-quit', () => {
    unregisterHotkeys()
  })
}
