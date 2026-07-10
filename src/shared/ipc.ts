// Имена IPC-каналов, общие для main и preload/renderer.

export const IPC = {
  // Настройки
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  onSettingsChanged: 'settings:changed',

  // Секреты (API-ключи / токены хранятся в main через safeStorage)
  setSecret: 'secret:set',
  hasSecret: 'secret:has',
  clearSecret: 'secret:clear',

  // LLM
  ask: 'llm:ask',
  cancelAsk: 'llm:cancel',
  onStream: 'llm:stream',
  testProvider: 'llm:test',

  // Захват экрана
  captureRegion: 'capture:region',
  captureScreen: 'capture:screen',
  beginRegionSelection: 'capture:begin-region',
  onCaptureResult: 'capture:result',
  selectionDone: 'selection:done',
  selectionCancel: 'selection:cancel',

  // Оверлей / окна
  toggleOverlay: 'overlay:toggle',
  hideOverlay: 'overlay:hide',
  showOverlay: 'overlay:show',
  moveOverlay: 'overlay:move',
  resizeOverlay: 'overlay:resize',
  setClickThrough: 'overlay:setClickThrough',
  setInteractive: 'overlay:setInteractive',
  openSettings: 'window:openSettings',
  quitApp: 'app:quit',

  // Хоткеи -> команды в рендерер
  onCommand: 'hotkey:command',

  // Аудио / транскрипт
  startListening: 'audio:start',
  stopListening: 'audio:stop',
  audioSegment: 'audio:segment',
  onTranscript: 'transcript:segment',
  listeningState: 'audio:state',

  // OAuth
  startOAuth: 'oauth:start',
  oauthStatus: 'oauth:status',

  // База знаний
  kbList: 'kb:list',
  kbGet: 'kb:get',
  kbAddText: 'kb:addText',
  kbUpdate: 'kb:update',
  kbImportFile: 'kb:importFile',
  kbRemove: 'kb:remove',
  kbClear: 'kb:clear',
  kbChanged: 'kb:changed'
} as const

/** Команды, которые main шлёт в оверлей по хоткеям/трею. */
export type OverlayCommand =
  | 'toggle-visibility'
  | 'capture-region'
  | 'capture-screen'
  | 'ask-last-question'
  | 'toggle-listening'
  | 'scroll-up'
  | 'scroll-down'
  | 'prev-answer'
  | 'next-answer'
  | 'clear'
