import { IPC, type OverlayCommand } from '@shared/ipc'
import { windows } from './windows'
import { captureScreen, downscaleDataUrl } from './capture'
import { askService } from './askService'
import type { StreamEvent } from '@shared/types'

/** Отправляет события стрима в оверлей. */
function emitStream(event: StreamEvent): void {
  windows.sendToOverlay(IPC.onStream, event)
}

/** Показать оверлей, если скрыт (перед выводом ответа). */
function ensureOverlayVisible(): void {
  windows.showOverlay()
}

export const commands = {
  toggleOverlay(): void {
    windows.toggleOverlay()
  },

  panicHide(): void {
    windows.hideOverlay()
    askService.cancelAll()
    // Останавливаем слушание на всякий случай.
    windows.sendToOverlay(IPC.onCommand, 'toggle-listening' as OverlayCommand)
  },

  toggleClickThrough(): void {
    windows.setClickThrough(!windows.isClickThrough())
    windows.sendToOverlay(IPC.setClickThrough, windows.isClickThrough())
  },

  /** Полный скриншот экрана -> вопрос к модели. */
  async captureScreenAndAsk(): Promise<void> {
    ensureOverlayVisible()
    try {
      const raw = await captureScreen()
      const dataUrl = downscaleDataUrl(raw)
      await askService.ask({ images: [{ dataUrl }] }, emitStream)
    } catch (err) {
      emitStream({
        type: 'error',
        requestId: 'capture',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  },

  /** Открыть оверлей выделения области. */
  captureRegion(): void {
    windows.createSelection()
  },

  /** Ответ по последнему услышанному вопросу (использует буфер транскрипта). */
  async askLastQuestion(): Promise<void> {
    ensureOverlayVisible()
    await askService.ask({ includeTranscript: true }, emitStream)
  },

  forwardToOverlay(cmd: OverlayCommand): void {
    ensureOverlayVisible()
    windows.sendToOverlay(IPC.onCommand, cmd)
  }
}
