// Общие типы, используемые в main / preload / renderer.

/** Активный LLM-провайдер и способ авторизации. */
export type ProviderConfig =
  | {
      kind: 'apikey'
      /** OpenAI-совместимый base URL. По умолчанию AllTokens. */
      baseUrl: string
      /** Идентификатор модели, например 'google/gemini-3.1-flash-lite'. */
      model: string
    }
  | { kind: 'oauth-google'; model: string }
  | { kind: 'oauth-anthropic'; model: string }
  | { kind: 'oauth-chatgpt'; model: string; source: 'codex-cli' | 'own-oauth' }

export type ProviderKind = ProviderConfig['kind']

/** Способ распознавания речи. */
export type SttMode = 'local-whisper' | 'cloud-alltokens' | 'codex' | 'web-speech'

export interface HotkeyMap {
  toggleOverlay: string
  captureRegion: string
  captureScreen: string
  askLastQuestion: string
  toggleListening: string
  panicHide: string
  toggleClickThrough: string
  prevAnswer: string
  nextAnswer: string
}

export type KnowledgeSearchMode = 'lexical' | 'semantic' | 'hybrid'

export const DEFAULT_EMBEDDING_MODEL = 'google/gemini-embedding-2'

/** Метаданные документа базы знаний (сам текст хранится отдельным файлом). */
export interface KnowledgeDocMeta {
  id: string
  title: string
  chars: number
  addedAt: number
  source: 'text' | 'file'
}

export interface Settings {
  provider: ProviderConfig
  /** Список сконфигурированных провайдеров (для быстрого переключения). */
  hotkeys: HotkeyMap
  stt: {
    mode: SttMode
    whisperModel: string // 'base' | 'small' | 'medium' | 'large-v3-turbo' ...
    captureSystemAudio: boolean
    captureMicrophone: boolean
    language: string // 'auto' | 'ru' | 'en' ...
  }
  behavior: {
    autoAnswerQuestions: boolean
    /** Перед авто-ответом проверять LLM-классификатором, что это вопрос ко мне. */
    classifyQuestions: boolean
    systemPrompt: string
    launchOnStartup: boolean
    overlayOpacity: number
  }
  knowledgeBase: {
    /** Использовать базу знаний при ответах (если есть документы). */
    enabled: boolean
    /** Тип поиска: лексический (BM25), семантический (эмбеддинги) или гибридный. */
    searchMode: KnowledgeSearchMode
    /** Модель эмбеддингов (OpenAI-совместимая, через AllTokens). */
    embeddingModel: string
  }
  /** Пользователь подтвердил предупреждение о записи разговора. */
  consentAcknowledged: boolean
  onboardingComplete: boolean
}

export const DEFAULT_ALLTOKENS_BASE_URL = 'https://api.alltokens.ru/api/v1'
export const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite'

export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggleOverlay: 'Control+\\',
  captureRegion: 'Control+Shift+S',
  captureScreen: 'Control+Shift+A',
  askLastQuestion: 'Control+Shift+Space',
  toggleListening: 'Control+Shift+L',
  panicHide: 'Control+Shift+X',
  toggleClickThrough: 'Control+Shift+C',
  prevAnswer: 'Control+Alt+Left',
  nextAnswer: 'Control+Alt+Right'
}

export const DEFAULT_SYSTEM_PROMPT =
  'Ты — незаметный помощник на экране пользователя. Отвечай кратко, точно и по делу. ' +
  'Если это задача по программированию — дай рабочее решение с коротким пояснением. ' +
  'Если это вопрос из разговора — дай прямой ответ, который можно быстро прочитать и произнести. ' +
  'Форматируй ответ в Markdown, код — в блоках с указанием языка.'

export const DEFAULT_SETTINGS: Settings = {
  provider: {
    kind: 'apikey',
    baseUrl: DEFAULT_ALLTOKENS_BASE_URL,
    model: DEFAULT_MODEL
  },
  hotkeys: DEFAULT_HOTKEYS,
  stt: {
    mode: 'cloud-alltokens',
    whisperModel: 'base',
    captureSystemAudio: true,
    captureMicrophone: true,
    language: 'auto'
  },
  behavior: {
    autoAnswerQuestions: true,
    classifyQuestions: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    launchOnStartup: false,
    overlayOpacity: 0.95
  },
  knowledgeBase: {
    enabled: true,
    searchMode: 'hybrid',
    embeddingModel: DEFAULT_EMBEDDING_MODEL
  },
  consentAcknowledged: false,
  onboardingComplete: false
}

/** Роль сообщения в диалоге с LLM. */
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatImage {
  /** data:image/png;base64,... */
  dataUrl: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  images?: ChatImage[]
}

export type AudioSourceKind = 'microphone' | 'system'

/** Прямоугольник области экрана (DIP-координаты рендерера). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Сегмент транскрипта из аудио-пайплайна. */
export interface TranscriptSegment {
  id: string
  source: AudioSourceKind
  text: string
  isQuestion: boolean
  startedAt: number
  final: boolean
}

/** Событие стрима ответа от LLM. */
export type StreamEvent =
  | { type: 'start'; requestId: string; title?: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }

export interface AskOptions {
  prompt?: string
  images?: ChatImage[]
  /** Добавить недавний транскрипт как контекст. */
  includeTranscript?: boolean
}
