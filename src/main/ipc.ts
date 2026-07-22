import { ipcMain, app, dialog, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import { settingsStore } from './settingsStore'
import { secretStore } from './secrets'
import { askService } from './askService'
import { windows } from './windows'
import { captureScreen, captureRegion, downscaleDataUrl, type Rect } from './capture'
import { transcriptBuffer } from './transcriptBuffer'
import { buildProvider } from './llm/router'
import { transcribe } from './stt'
import { isQuestion } from './questionDetector'
import { isAnswerableQuestion } from './questionClassifier'
import { knowledgeStore } from './knowledge/store'
import type {
  AskOptions,
  ProviderConfig,
  Settings,
  TranscriptSegment,
  StreamEvent,
  AudioSourceKind
} from '@shared/types'

export function registerIpc(): void {
  // ---- Настройки ----
  ipcMain.handle(IPC.getSettings, () => settingsStore.get())
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<Settings>) => {
    const updated = settingsStore.update(patch)
    if (patch.behavior?.overlayOpacity !== undefined && windows.overlay) {
      windows.overlay.setOpacity(updated.behavior.overlayOpacity)
    }
    windows.broadcast(IPC.onSettingsChanged, updated)
    return updated
  })

  // ---- Секреты ----
  ipcMain.handle(IPC.setSecret, (_e, key: string, value: string) => {
    secretStore.set(key, value)
    return true
  })
  ipcMain.handle(IPC.hasSecret, (_e, key: string) => secretStore.has(key))
  ipcMain.handle(IPC.clearSecret, (_e, key: string) => {
    secretStore.clear(key)
    return true
  })

  // ---- LLM ----
  ipcMain.handle(IPC.ask, async (event: IpcMainInvokeEvent, opts: AskOptions) => {
    const emit = (ev: StreamEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.onStream, ev)
    }
    return askService.ask(opts, emit)
  })
  ipcMain.on(IPC.cancelAsk, (_e, requestId: string) => askService.cancel(requestId))

  ipcMain.handle(IPC.testProvider, async (_e, config: ProviderConfig) => {
    try {
      const provider = buildProvider(config)
      return provider.test()
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Захват экрана ----
  ipcMain.handle(IPC.captureScreen, async () => downscaleDataUrl(await captureScreen()))
  ipcMain.handle(IPC.captureRegion, async (_e, rect: Rect) =>
    downscaleDataUrl(await captureRegion(rect))
  )

  // Результат выделения из selection-окна: снимаем регион и спрашиваем модель.
  ipcMain.on(IPC.selectionDone, async (_e, rect: Rect) => {
    windows.closeSelection()
    windows.showOverlay()
    try {
      const dataUrl = downscaleDataUrl(await captureRegion(rect))
      const emit = (ev: StreamEvent): void => windows.sendToOverlay(IPC.onStream, ev)
      await askService.ask({ images: [{ dataUrl }] }, emit)
    } catch (err) {
      windows.sendToOverlay(IPC.onStream, {
        type: 'error',
        requestId: 'region',
        message: err instanceof Error ? err.message : String(err)
      } satisfies StreamEvent)
    }
  })
  ipcMain.on(IPC.selectionCancel, () => windows.closeSelection())
  ipcMain.on(IPC.beginRegionSelection, () => windows.createSelection())

  // ---- Оверлей ----
  ipcMain.on(IPC.toggleOverlay, () => windows.toggleOverlay())
  ipcMain.on(IPC.hideOverlay, () => windows.hideOverlay())
  ipcMain.on(IPC.showOverlay, () => windows.showOverlay())
  ipcMain.on(IPC.moveOverlay, (_e, dx: number, dy: number) => windows.moveOverlay(dx, dy))
  ipcMain.on(IPC.resizeOverlay, (_e, w: number, h: number) => windows.resizeOverlay(w, h))
  ipcMain.on(IPC.setClickThrough, (_e, enabled: boolean) => windows.setClickThrough(enabled))
  ipcMain.on(IPC.setInteractive, (_e, interactive: boolean) => windows.setInteractive(interactive))
  ipcMain.on(IPC.openSettings, () => windows.createSettings())
  ipcMain.on(IPC.quitApp, () => app.quit())

  // ---- Аудио-сегмент из рендерера: транскрибируем и раздаём как транскрипт ----
  type AudioPayload = { source: AudioSourceKind; wav: string }
  let transcriptionQueue: Promise<void> = Promise.resolve()
  let answerQueue: Promise<void> = Promise.resolve()

  const emitAudioError = (err: unknown): void => {
    windows.sendToOverlay(IPC.onStream, {
      type: 'error',
      requestId: 'stt',
      message: err instanceof Error ? err.message : String(err)
    } satisfies StreamEvent)
  }

  const answerTranscript = async (seg: TranscriptSegment): Promise<void> => {
    const behavior = settingsStore.get().behavior
    if (!behavior.autoAnswerQuestions) return

    // Опциональный LLM-фильтр: точно ли это вопрос ко мне.
    if (behavior.classifyQuestions) {
      try {
        const ok = await isAnswerableQuestion(seg.text, transcriptBuffer.recentText())
        if (!ok) return
      } catch {
        // Классификатор недоступен — не теряем вопрос, отвечаем.
      }
    }
    windows.showOverlay()
    const emit = (ev: StreamEvent): void => windows.sendToOverlay(IPC.onStream, ev)
    await askService.ask({ prompt: seg.text, includeTranscript: true }, emit)
  }

  const processAudioSegment = async (payload: AudioPayload): Promise<void> => {
    const text = await transcribe(payload.wav)
    if (!text) return
    const seg: TranscriptSegment = {
      id: randomUUID(),
      source: payload.source,
      text,
      isQuestion: isQuestion(text),
      startedAt: Date.now(),
      final: true
    }
    transcriptBuffer.add(seg)
    windows.sendToOverlay(IPC.onTranscript, seg)

    if (seg.isQuestion && settingsStore.get().behavior.autoAnswerQuestions) {
      // Ответы идут строго по одному. Ошибка одной задачи не ломает очередь.
      answerQueue = answerQueue.then(() => answerTranscript(seg)).catch(emitAudioError)
    }
  }

  ipcMain.on(IPC.audioSegment, (_e, payload: AudioPayload) => {
    // VAD микрофона и системного звука может завершить два сегмента одновременно.
    // Последовательная очередь сохраняет порядок и не создаёт всплеск API-вызовов.
    transcriptionQueue = transcriptionQueue
      .then(() => processAudioSegment(payload))
      .catch(emitAudioError)
  })

  ipcMain.on(IPC.listeningState, (_e, listening: boolean) => {
    windows.broadcast(IPC.listeningState, listening)
  })

  // ---- База знаний ----
  const broadcastKb = (): void => windows.broadcast(IPC.kbChanged, knowledgeStore.list())

  ipcMain.handle(IPC.kbList, () => knowledgeStore.list())
  ipcMain.handle(IPC.kbGet, (_e, id: string) => knowledgeStore.getText(id))
  ipcMain.handle(IPC.kbAddText, (_e, payload: { title: string; text: string }) => {
    const meta = knowledgeStore.addText(payload.title, payload.text)
    broadcastKb()
    return meta
  })
  ipcMain.handle(
    IPC.kbUpdate,
    (_e, payload: { id: string; title: string; text: string }) => {
      const meta = knowledgeStore.update(payload.id, payload.title, payload.text)
      broadcastKb()
      return meta
    }
  )
  ipcMain.handle(IPC.kbImportFile, async () => {
    const parent = windows.settings ?? undefined
    const result = await dialog.showOpenDialog(parent!, {
      title: 'Добавить файл в базу знаний',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Документы', extensions: ['txt', 'md', 'markdown', 'pdf', 'json', 'csv'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { added: [], errors: [] }
    const added: string[] = []
    const errors: string[] = []
    for (const fp of result.filePaths) {
      try {
        const meta = await knowledgeStore.importFile(fp)
        added.push(meta.title)
      } catch (err) {
        errors.push(`${fp}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    broadcastKb()
    return { added, errors }
  })
  ipcMain.handle(IPC.kbRemove, (_e, id: string) => {
    knowledgeStore.remove(id)
    broadcastKb()
    return true
  })
  ipcMain.handle(IPC.kbClear, () => {
    knowledgeStore.clear()
    broadcastKb()
    return true
  })
}
