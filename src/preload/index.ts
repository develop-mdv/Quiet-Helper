import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type OverlayCommand } from '@shared/ipc'
import type {
  AskOptions,
  AudioSourceKind,
  KnowledgeDocMeta,
  ProviderConfig,
  Rect,
  Settings,
  StreamEvent,
  TranscriptSegment
} from '@shared/types'

const api = {
  // Настройки
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettingsChanged: (cb: (s: Settings) => void): (() => void) =>
    subscribe(IPC.onSettingsChanged, cb),

  // Секреты
  setSecret: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setSecret, key, value),
  hasSecret: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.hasSecret, key),
  clearSecret: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.clearSecret, key),

  // LLM
  ask: (opts: AskOptions): Promise<string> => ipcRenderer.invoke(IPC.ask, opts),
  cancelAsk: (requestId: string): void => ipcRenderer.send(IPC.cancelAsk, requestId),
  onStream: (cb: (e: StreamEvent) => void): (() => void) => subscribe(IPC.onStream, cb),
  testProvider: (config: ProviderConfig): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.testProvider, config),

  // Захват
  captureScreen: (): Promise<string> => ipcRenderer.invoke(IPC.captureScreen),
  captureRegion: (rect: Rect): Promise<string> => ipcRenderer.invoke(IPC.captureRegion, rect),
  beginRegionSelection: (): void => ipcRenderer.send(IPC.beginRegionSelection),
  selectionDone: (rect: Rect): void => ipcRenderer.send(IPC.selectionDone, rect),
  selectionCancel: (): void => ipcRenderer.send(IPC.selectionCancel),

  // Оверлей / окна
  toggleOverlay: (): void => ipcRenderer.send(IPC.toggleOverlay),
  hideOverlay: (): void => ipcRenderer.send(IPC.hideOverlay),
  showOverlay: (): void => ipcRenderer.send(IPC.showOverlay),
  moveOverlay: (dx: number, dy: number): void => ipcRenderer.send(IPC.moveOverlay, dx, dy),
  resizeOverlay: (width: number, height: number): void =>
    ipcRenderer.send(IPC.resizeOverlay, width, height),
  setClickThrough: (enabled: boolean): void => ipcRenderer.send(IPC.setClickThrough, enabled),
  setInteractive: (interactive: boolean): void =>
    ipcRenderer.send(IPC.setInteractive, interactive),
  onSetClickThrough: (cb: (enabled: boolean) => void): (() => void) =>
    subscribe(IPC.setClickThrough, cb),
  openSettings: (): void => ipcRenderer.send(IPC.openSettings),
  quitApp: (): void => ipcRenderer.send(IPC.quitApp),

  // Команды по хоткеям
  onCommand: (cb: (cmd: OverlayCommand) => void): (() => void) => subscribe(IPC.onCommand, cb),

  // Транскрипт / аудио
  sendAudioSegment: (payload: { source: AudioSourceKind; wav: string }): void =>
    ipcRenderer.send(IPC.audioSegment, payload),
  onTranscript: (cb: (seg: TranscriptSegment) => void): (() => void) =>
    subscribe(IPC.onTranscript, cb),
  setListeningState: (listening: boolean): void => ipcRenderer.send(IPC.listeningState, listening),
  onListeningState: (cb: (listening: boolean) => void): (() => void) =>
    subscribe(IPC.listeningState, cb),

  // База знаний
  kbList: (): Promise<KnowledgeDocMeta[]> => ipcRenderer.invoke(IPC.kbList),
  kbGet: (id: string): Promise<string> => ipcRenderer.invoke(IPC.kbGet, id),
  kbAddText: (title: string, text: string): Promise<KnowledgeDocMeta> =>
    ipcRenderer.invoke(IPC.kbAddText, { title, text }),
  kbUpdate: (id: string, title: string, text: string): Promise<KnowledgeDocMeta> =>
    ipcRenderer.invoke(IPC.kbUpdate, { id, title, text }),
  kbImportFile: (): Promise<{ added: string[]; errors: string[] }> =>
    ipcRenderer.invoke(IPC.kbImportFile),
  kbRemove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.kbRemove, id),
  kbClear: (): Promise<boolean> => ipcRenderer.invoke(IPC.kbClear),
  onKbChanged: (cb: (docs: KnowledgeDocMeta[]) => void): (() => void) =>
    subscribe(IPC.kbChanged, cb)
}

/** Подписка на IPC-событие с корректной отпиской. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', api)

export type QuietHelperApi = typeof api
