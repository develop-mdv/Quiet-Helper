import { BrowserWindow } from 'electron'

/**
 * Применяет к окну «стелс»-режим: невидимость для программного захвата экрана
 * (Zoom/Teams/OBS/Discord), always-on-top поверх полноэкранных приложений,
 * отсутствие в таскбаре.
 *
 * Пределы: не защищает от физической камеры на монитор и от захвата уровня
 * драйвера/ядра. На Linux setContentProtection — no-op (наш таргет — Windows).
 */
export function applyStealth(win: BrowserWindow): void {
  // Главный механизм: Windows WDA_EXCLUDEFROMCAPTURE.
  win.setContentProtection(true)

  // Поверх всего, включая полноэкранные звонки/презентации.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Не показывать в таскбаре.
  win.setSkipTaskbar(true)

  // ВАЖНО: в ряде версий Electron win.hide() сбрасывает contentProtection,
  // и после повторного показа окно снова попадает в захват. Поэтому
  // переустанавливаем защиту при каждом событии show.
  win.on('show', () => reassertStealth(win))
}

/** Повторно включает защиту от захвата и «поверх всего» (после show/hide). */
export function reassertStealth(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setContentProtection(true)
  win.setAlwaysOnTop(true, 'screen-saver')
}

/**
 * Клик-сквозь: окно не перехватывает мышь (нужно, чтобы не красть фокус во время
 * звонка). forward: true позволяет всё же получать hover-события в рендерере.
 */
export function setClickThrough(win: BrowserWindow, enabled: boolean): void {
  win.setIgnoreMouseEvents(enabled, { forward: true })
}
