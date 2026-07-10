import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { applyStealth, reassertStealth, setClickThrough } from './stealth'
import { settingsStore } from './settingsStore'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

/** Загружает renderer-энтрипоинт (dev-сервер или собранный html). */
function loadEntry(win: BrowserWindow, entry: 'overlay' | 'settings' | 'selection'): void {
  if (RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/${entry}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${entry}.html`))
  }
}

class WindowManager {
  overlay: BrowserWindow | null = null
  settings: BrowserWindow | null = null
  selection: BrowserWindow | null = null

  // По умолчанию окно интерактивно (можно кликать/печатать). Сквозной режим
  // включается вручную (Ctrl+Shift+C) перед демонстрацией экрана/звонком.
  private clickThrough = false

  createOverlay(): BrowserWindow {
    if (this.overlay && !this.overlay.isDestroyed()) return this.overlay

    const { workArea } = screen.getPrimaryDisplay()
    const width = 460
    const height = 620

    const win = new BrowserWindow({
      width,
      height,
      x: workArea.x + workArea.width - width - 24,
      y: workArea.y + 48,
      frame: false,
      transparent: true,
      resizable: true,
      minWidth: 320,
      minHeight: 240,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // Нужно для захвата аудио через getUserMedia/getDisplayMedia в рендерере.
        backgroundThrottling: false
      }
    })

    applyStealth(win)
    setClickThrough(win, this.clickThrough)
    win.setOpacity(settingsStore.get().behavior.overlayOpacity)

    loadEntry(win, 'overlay')
    win.on('closed', () => {
      this.overlay = null
    })
    win.once('ready-to-show', () => win.show())

    this.overlay = win
    return win
  }

  toggleOverlay(): void {
    const win = this.overlay
    if (!win || win.isDestroyed()) {
      this.createOverlay()
      return
    }
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      reassertStealth(win)
    }
  }

  hideOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.hide()
  }

  showOverlay(): void {
    const win = this.overlay && !this.overlay.isDestroyed() ? this.overlay : this.createOverlay()
    win.show()
    reassertStealth(win)
  }

  moveOverlay(dx: number, dy: number): void {
    const win = this.overlay
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  }

  resizeOverlay(width: number, height: number): void {
    const win = this.overlay
    if (!win || win.isDestroyed()) return
    win.setSize(Math.max(320, Math.round(width)), Math.max(240, Math.round(height)))
  }

  setClickThrough(enabled: boolean): void {
    this.clickThrough = enabled
    if (this.overlay && !this.overlay.isDestroyed()) setClickThrough(this.overlay, enabled)
  }

  /** Временно делает окно интерактивным (для набора текста в панели). */
  setInteractive(interactive: boolean): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      setClickThrough(this.overlay, !interactive)
    }
  }

  isClickThrough(): boolean {
    return this.clickThrough
  }

  createSettings(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.focus()
      return this.settings
    }
    const win = new BrowserWindow({
      width: 720,
      height: 720,
      title: 'Настройки — Quiet Helper',
      resizable: true,
      minimizable: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    // Окно настроек тоже скрываем из захвата — на случай, если открыто во время шаринга.
    win.setContentProtection(true)
    win.on('show', () => {
      if (!win.isDestroyed()) win.setContentProtection(true)
    })
    loadEntry(win, 'settings')
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.settings = null
    })
    this.settings = win
    return win
  }

  /** Полноэкранное прозрачное окно для выделения области экрана. */
  createSelection(): BrowserWindow {
    if (this.selection && !this.selection.isDestroyed()) return this.selection

    const { bounds } = screen.getPrimaryDisplay()
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      fullscreen: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    win.setContentProtection(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.on('show', () => reassertStealth(win))
    loadEntry(win, 'selection')
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    win.on('closed', () => {
      this.selection = null
    })
    this.selection = win
    return win
  }

  closeSelection(): void {
    if (this.selection && !this.selection.isDestroyed()) this.selection.close()
    this.selection = null
  }

  /** Шлёт событие в оверлей (если он есть). */
  sendToOverlay(channel: string, ...args: unknown[]): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.webContents.send(channel, ...args)
    }
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of [this.overlay, this.settings, this.selection]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }
}

export const windows = new WindowManager()
