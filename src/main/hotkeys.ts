import { globalShortcut } from 'electron'
import { settingsStore } from './settingsStore'
import { commands } from './commands'
import { windows } from './windows'
import type { HotkeyMap } from '@shared/types'

/** Регистрирует глобальные хоткеи по текущим настройкам. */
export function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const hk = settingsStore.get().hotkeys

  const bind = (accel: string, fn: () => void): void => {
    if (!accel) return
    try {
      globalShortcut.register(accel, fn)
    } catch (err) {
      console.error(`[hotkeys] не удалось зарегистрировать ${accel}:`, err)
    }
  }

  bind(hk.toggleOverlay, () => commands.toggleOverlay())
  bind(hk.captureRegion, () => commands.captureRegion())
  bind(hk.captureScreen, () => void commands.captureScreenAndAsk())
  bind(hk.askLastQuestion, () => void commands.askLastQuestion())
  bind(hk.toggleListening, () => commands.forwardToOverlay('toggle-listening'))
  bind(hk.panicHide, () => commands.panicHide())
  bind(hk.toggleClickThrough, () => commands.toggleClickThrough())
  bind(hk.prevAnswer, () => commands.forwardToOverlay('prev-answer'))
  bind(hk.nextAnswer, () => commands.forwardToOverlay('next-answer'))

  // Перемещение оверлея и скролл ответа.
  const step = 40
  bind('Control+Up', () => windows.moveOverlay(0, -step))
  bind('Control+Down', () => windows.moveOverlay(0, step))
  bind('Control+Left', () => windows.moveOverlay(-step, 0))
  bind('Control+Right', () => windows.moveOverlay(step, 0))
  bind('Alt+Up', () => commands.forwardToOverlay('scroll-up'))
  bind('Alt+Down', () => commands.forwardToOverlay('scroll-down'))
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}

/** Перерегистрация при изменении настроек. */
export function watchHotkeys(): void {
  settingsStore.onChange(() => registerHotkeys())
}
