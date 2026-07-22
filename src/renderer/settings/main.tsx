import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  DEFAULT_ALLTOKENS_BASE_URL,
  DEFAULT_MODEL,
  type KnowledgeDocMeta,
  type KnowledgeSearchMode,
  type ProviderConfig,
  type ProviderKind,
  type Settings,
  type SttMode
} from '@shared/types'
import '../styles.css'

const SECRET_ALLTOKENS = 'alltokens.apiKey'

// Порядок = приоритет в UI: сначала два рабочих способа (ключ и Codex), затем OAuth-заглушки.
const PROVIDER_LABELS: Record<ProviderKind, string> = {
  apikey: 'API-ключ (AllTokens)',
  'oauth-chatgpt': 'Подписка ChatGPT (Codex)',
  'oauth-google': 'Google Gemini (OAuth)',
  'oauth-anthropic': 'Claude (OAuth)'
}

interface ModelOption {
  id: string
  label: string
}

/** Модели для API-ключа AllTokens (все с поддержкой изображений — нужно для вопросов с экрана). */
const API_MODELS: ModelOption[] = [
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite — дёшево, фото+аудио (рекоменд.)' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash — сильнее, мультимодальная' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 — премиум, фото, 1M контекст' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5 — reasoning, фото' },
  { id: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus — экономно, фото' }
]

/**
 * Модели Codex, доступные с ChatGPT-аккаунтом (GPT-5.6, GA июль 2026).
 * Проверено запросом: Sol и Terra принимаются (200); голый алиас gpt-5.6 → 400,
 * gpt-5.6-luna → 404 (в Codex пока недоступна), поэтому их тут нет.
 */
const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — флагман, макс. качество (Plus/Pro)' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — повседневная, дешевле (все тарифы)' }
]

function modelsFor(kind: ProviderKind): ModelOption[] {
  if (kind === 'apikey') return API_MODELS
  if (kind === 'oauth-chatgpt') return CODEX_MODELS
  return []
}

/** Embedding-модели AllTokens (проверено, что существуют). Эмбеддинги всегда идут по
 * ключу AllTokens — у подписки ChatGPT/Codex эндпоинта эмбеддингов нет. */
const EMBEDDING_MODELS: ModelOption[] = [
  { id: 'google/gemini-embedding-2', label: 'Gemini Embedding 2 — мультиязычная (рекоменд.)' },
  { id: 'baai/bge-m3', label: 'BGE-M3 — мультиязычная, очень дёшево' },
  { id: 'openai/text-embedding-3-large', label: 'OpenAI 3 Large — сильная' },
  { id: 'openai/text-embedding-3-small', label: 'OpenAI 3 Small — быстрая, дёшево' },
  { id: 'qwen/qwen3-embedding-8b', label: 'Qwen3 Embedding 8B — 32k контекст' }
]

/** Устаревшие Codex-модели (свёрнуты в пользу GPT-5.6) — авто-миграция на gpt-5.6-sol. */
const DEPRECATED_CODEX = new Set([
  'gpt-5-codex',
  'gpt-5',
  'gpt-5.1-codex',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6'
])

const STT_LABELS: Record<SttMode, string> = {
  'local-whisper': 'Локальный Whisper',
  'cloud-alltokens': 'Облако (AllTokens)',
  codex: 'Codex (подписка ChatGPT)',
  'web-speech': 'Web Speech (мик)'
}

function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [docs, setDocs] = useState<KnowledgeDocMeta[]>([])
  const [kbTitle, setKbTitle] = useState('')
  const [kbText, setKbText] = useState('')
  const [kbMsg, setKbMsg] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [embCustom, setEmbCustom] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.api.getSettings()
      // Авто-миграция устаревшей модели Codex на рекомендуемую.
      if (s.provider.kind === 'oauth-chatgpt' && DEPRECATED_CODEX.has(s.provider.model)) {
        s.provider = { ...s.provider, model: 'gpt-5.6-sol' }
      }
      setSettings(s)
      // Если сохранённая модель не из каталога — сразу режим «своя модель».
      const known = modelsFor(s.provider.kind).some((m) => m.id === s.provider.model)
      setCustomModel(modelsFor(s.provider.kind).length > 0 && !known)
      setHasKey(await window.api.hasSecret(SECRET_ALLTOKENS))
      setDocs(await window.api.kbList())
      setEmbCustom(!EMBEDDING_MODELS.some((m) => m.id === s.knowledgeBase.embeddingModel))
    })()
    return window.api.onKbChanged(setDocs)
  }, [])

  if (!settings) return <div className="settings">Загрузка…</div>

  const provider = settings.provider
  const patch = (p: Partial<Settings>): void => setSettings({ ...settings, ...p } as Settings)
  const patchProvider = (p: Partial<ProviderConfig>): void =>
    setSettings({ ...settings, provider: { ...provider, ...p } as ProviderConfig })
  // Настройки базы знаний сохраняем сразу (без кнопки «Сохранить»).
  const patchKb = (p: Partial<Settings['knowledgeBase']>): void => {
    const next = { ...settings.knowledgeBase, ...p }
    setSettings({ ...settings, knowledgeBase: next })
    void window.api.updateSettings({ knowledgeBase: next })
  }

  const setKind = (kind: ProviderKind): void => {
    // При смене способа берём рекомендуемую модель этого способа (модели несовместимы).
    let next: ProviderConfig
    if (kind === 'apikey') {
      next = { kind, baseUrl: DEFAULT_ALLTOKENS_BASE_URL, model: DEFAULT_MODEL }
    } else if (kind === 'oauth-chatgpt') {
      next = { kind, model: 'gpt-5.6-sol', source: 'codex-cli' }
    } else {
      next = { kind, model: DEFAULT_MODEL }
    }
    setSettings({ ...settings, provider: next })
    setCustomModel(false)
    setTest(null)
  }

  /** Атомарно включает весь рабочий контур, а не только провайдера ответов. */
  const enableAllTokensFullCycle = async (): Promise<void> => {
    const enteredKey = apiKey.trim()
    if (!hasKey && !enteredKey) {
      setTest({ ok: false, message: 'Сначала введите API-ключ AllTokens.' })
      return
    }
    if (enteredKey) {
      await window.api.setSecret(SECRET_ALLTOKENS, enteredKey)
      setHasKey(true)
      setApiKey('')
    }

    const nextProvider: ProviderConfig = {
      kind: 'apikey',
      baseUrl: DEFAULT_ALLTOKENS_BASE_URL,
      model: DEFAULT_MODEL
    }
    const nextStt: Settings['stt'] = { ...settings.stt, mode: 'cloud-alltokens' }
    const nextBehavior: Settings['behavior'] = {
      ...settings.behavior,
      autoAnswerQuestions: true,
      // Локальная эвристика уже находит вопросы. Второй LLM-вызов увеличивает
      // задержку и занимает ещё один API-слот перед каждым ответом.
      classifyQuestions: false
    }
    setSettings({
      ...settings,
      provider: nextProvider,
      stt: nextStt,
      behavior: nextBehavior
    })
    setCustomModel(false)
    await window.api.updateSettings({
      provider: nextProvider,
      stt: nextStt,
      behavior: nextBehavior
    })
    setTest({ ok: true, message: 'Полный цикл AllTokens включён: аудио → текст → автоответ.' })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const save = async (markOnboarded = false): Promise<void> => {
    if (apiKey.trim()) {
      await window.api.setSecret(SECRET_ALLTOKENS, apiKey.trim())
      setHasKey(true)
      setApiKey('')
    }
    await window.api.updateSettings({
      provider: settings.provider,
      hotkeys: settings.hotkeys,
      stt: settings.stt,
      behavior: settings.behavior,
      knowledgeBase: settings.knowledgeBase,
      consentAcknowledged: settings.consentAcknowledged,
      ...(markOnboarded ? { onboardingComplete: true } : {})
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    if (provider.kind === 'apikey' && apiKey.trim()) {
      await window.api.setSecret(SECRET_ALLTOKENS, apiKey.trim())
      setHasKey(true)
      setApiKey('')
    }
    const res = await window.api.testProvider(settings.provider)
    setTest(res)
    setTesting(false)
  }

  const saveKb = async (): Promise<void> => {
    if (!kbText.trim()) return
    if (editingId) {
      await window.api.kbUpdate(editingId, kbTitle, kbText)
      setKbMsg('Изменения сохранены')
    } else {
      await window.api.kbAddText(kbTitle, kbText)
      setKbMsg('Добавлено в базу знаний')
    }
    setEditingId(null)
    setKbTitle('')
    setKbText('')
    setTimeout(() => setKbMsg(''), 1600)
  }

  const startEdit = async (d: KnowledgeDocMeta): Promise<void> => {
    const text = await window.api.kbGet(d.id)
    setEditingId(d.id)
    setKbTitle(d.title)
    setKbText(text)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setKbTitle('')
    setKbText('')
  }

  // Сохранить ключ AllTokens (нужен для эмбеддингов, даже если отвечает Codex/OAuth).
  const saveAllTokensKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    await window.api.setSecret(SECRET_ALLTOKENS, apiKey.trim())
    setHasKey(true)
    setApiKey('')
    setKbMsg('Ключ AllTokens сохранён — семантический поиск включён')
    setTimeout(() => setKbMsg(''), 2200)
  }

  const importKbFile = async (): Promise<void> => {
    const res = await window.api.kbImportFile()
    const parts: string[] = []
    if (res.added.length) parts.push(`Добавлено: ${res.added.join(', ')}`)
    if (res.errors.length) parts.push(`Ошибки: ${res.errors.join('; ')}`)
    setKbMsg(parts.join(' · ') || 'Файл не выбран')
    setTimeout(() => setKbMsg(''), 5000)
  }

  const kbTotalChars = docs.reduce((n, d) => n + d.chars, 0)

  return (
    <div className="settings">
      <h1>Quiet Helper — настройки</h1>
      <div className="sub">
        Приватный помощник со стелс-оверлеем. Невидим при демонстрации экрана (Zoom/Teams/OBS).
      </div>

      {!settings.onboardingComplete && (
        <div className="warn-box">
          Быстрый старт: выберите провайдера, введите ключ (или войдите), нажмите
          «Проверить», затем «Завершить настройку».
        </div>
      )}

      {/* Провайдер */}
      <div className="section">
        <h2>Модель и доступ</h2>
        <div
          className={
            provider.kind === 'apikey' &&
            settings.stt.mode === 'cloud-alltokens' &&
            settings.behavior.autoAnswerQuestions
              ? 'status ok'
              : 'warn-box'
          }
        >
          <div>
            <b>Полный цикл через AllTokens API</b>
            <br />
            Один режим включает ответы, облачную расшифровку и автоответ на найденные вопросы.
          </div>
          <button
            className="btn primary"
            style={{ marginTop: 10 }}
            onClick={() => void enableAllTokensFullCycle()}
          >
            Включить полный цикл API
          </button>
        </div>
        <div className="field">
          <label>Провайдер</label>
          <div className="pill-group">
            {(Object.keys(PROVIDER_LABELS) as ProviderKind[]).map((k) => (
              <div
                key={k}
                className={`pill ${provider.kind === k ? 'active' : ''}`}
                onClick={() => setKind(k)}
              >
                {PROVIDER_LABELS[k]}
              </div>
            ))}
          </div>
        </div>

        {provider.kind === 'apikey' && (
          <>
            <div className="field">
              <label>Base URL (OpenAI-совместимый)</label>
              <input
                type="text"
                value={provider.baseUrl}
                onChange={(e) => patchProvider({ baseUrl: e.target.value })}
              />
            </div>
            <div className="field">
              <label>API-ключ AllTokens {hasKey && '· (ключ сохранён)'}</label>
              <input
                type="password"
                placeholder={hasKey ? '•••••••• (оставьте пустым, чтобы не менять)' : 'sk-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div className="hint">
                Ключ шифруется локально (DPAPI) и не покидает ваш компьютер, кроме запросов к API.
              </div>
            </div>
          </>
        )}

        {provider.kind === 'oauth-chatgpt' && (
          <>
            <div className="warn-box">
              ChatGPT через Codex OAuth использует вашу подписку ChatGPT (как «Sign in with
              ChatGPT» в Codex CLI). Путь неофициальный для сторонних приложений и может
              перестать работать при изменениях OpenAI. Только личный аккаунт, без раздачи
              токенов.
            </div>
            <div className="field">
              <label>Источник авторизации</label>
              <div className="pill-group">
                {(['codex-cli', 'own-oauth'] as const).map((s) => (
                  <div
                    key={s}
                    className={`pill ${
                      provider.kind === 'oauth-chatgpt' && provider.source === s ? 'active' : ''
                    }`}
                    onClick={() => patchProvider({ source: s })}
                  >
                    {s === 'codex-cli' ? 'Codex CLI (~/.codex/auth.json)' : 'Свой OAuth (M6)'}
                  </div>
                ))}
              </div>
              <div className="hint">
                Режим «Codex CLI»: установите Codex и выполните <code>codex login</code> — токен
                будет взят автоматически.
              </div>
            </div>
          </>
        )}

        {(provider.kind === 'oauth-google' || provider.kind === 'oauth-anthropic') && (
          <div className="warn-box">
            Официальный OAuth ({PROVIDER_LABELS[provider.kind]}) будет подключён на этапе M6.
            Пока используйте API-ключ AllTokens.
          </div>
        )}

        <div className="field">
          <label>Модель</label>
          {modelsFor(provider.kind).length > 0 ? (
            <>
              <select
                value={customModel ? '__custom__' : provider.model}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomModel(true)
                  } else {
                    setCustomModel(false)
                    patchProvider({ model: e.target.value })
                  }
                }}
              >
                {modelsFor(provider.kind).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {!customModel &&
                  !modelsFor(provider.kind).some((m) => m.id === provider.model) && (
                    <option value={provider.model}>{provider.model} (текущая)</option>
                  )}
                <option value="__custom__">✏️ Другая модель…</option>
              </select>
              {customModel && (
                <input
                  type="text"
                  placeholder="Точный ID модели, напр. google/gemini-3.5-flash"
                  value={provider.model}
                  onChange={(e) => patchProvider({ model: e.target.value })}
                  style={{ marginTop: 8 }}
                />
              )}
              <div className="hint">
                {provider.kind === 'apikey'
                  ? 'Все модели в списке понимают изображения (для вопросов с экрана). Облачная транскрибация аудио работает только с моделями Gemini.'
                  : 'Модели тарифицируются по вашей подписке ChatGPT. Варианты gpt-5.x-codex для ChatGPT-аккаунта не поддерживаются.'}
              </div>
            </>
          ) : (
            <input
              type="text"
              value={provider.model}
              onChange={(e) => patchProvider({ model: e.target.value })}
            />
          )}
        </div>

        <div className="actions">
          <button className="btn" onClick={runTest} disabled={testing}>
            {testing ? 'Проверяю…' : 'Проверить подключение'}
          </button>
        </div>
        {test && (
          <div className={`status ${test.ok ? 'ok' : 'err'}`}>
            {test.ok ? '✓ ' : '✕ '}
            {test.message}
          </div>
        )}
      </div>

      {/* Распознавание речи */}
      <div className="section">
        <h2>Слушание разговора (STT)</h2>
        <div className="field">
          <label>Движок распознавания</label>
          <div className="pill-group">
            {(['local-whisper', 'codex', 'cloud-alltokens'] as SttMode[]).map((m) => (
              <div
                key={m}
                className={`pill ${settings.stt.mode === m ? 'active' : ''}`}
                onClick={() => patch({ stt: { ...settings.stt, mode: m } })}
              >
                {STT_LABELS[m]}
              </div>
            ))}
          </div>
          <div className="hint">
            <b>Локальный Whisper</b> — офлайн и бесплатно, требует установки модели.{' '}
            <b>Codex</b> — по вашей подписке ChatGPT (whisper-1), нужен <code>codex login</code>.{' '}
            <b>Облако AllTokens</b> — по API-ключу (Gemini). Если локальный Whisper не установлен,
            используется облако AllTokens.
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Модель Whisper</label>
            <select
              value={settings.stt.whisperModel}
              onChange={(e) => patch({ stt: { ...settings.stt, whisperModel: e.target.value } })}
            >
              {['base', 'small', 'medium', 'large-v3-turbo'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Язык</label>
            <select
              value={settings.stt.language}
              onChange={(e) => patch({ stt: { ...settings.stt, language: e.target.value } })}
            >
              {['auto', 'ru', 'en'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.stt.captureMicrophone}
            onChange={(e) => patch({ stt: { ...settings.stt, captureMicrophone: e.target.checked } })}
          />
          Слушать мой микрофон
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.stt.captureSystemAudio}
            onChange={(e) =>
              patch({ stt: { ...settings.stt, captureSystemAudio: e.target.checked } })
            }
          />
          Слушать системный звук (голос собеседника в звонке)
        </label>
      </div>

      {/* Поведение */}
      <div className="section">
        <h2>Поведение</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.behavior.autoAnswerQuestions}
            onChange={(e) =>
              patch({ behavior: { ...settings.behavior, autoAnswerQuestions: e.target.checked } })
            }
          />
          Автоматически отвечать на распознанные вопросы
        </label>
        <label className="check" style={{ opacity: settings.behavior.autoAnswerQuestions ? 1 : 0.5 }}>
          <input
            type="checkbox"
            disabled={!settings.behavior.autoAnswerQuestions}
            checked={settings.behavior.classifyQuestions}
            onChange={(e) =>
              patch({ behavior: { ...settings.behavior, classifyQuestions: e.target.checked } })
            }
          />
          Умный фильтр: отвечать только на вопросы, обращённые ко мне (LLM-проверка)
        </label>
        <div className="field">
          <label>Системный промпт (стиль ответов)</label>
          <textarea
            rows={4}
            value={settings.behavior.systemPrompt}
            onChange={(e) =>
              patch({ behavior: { ...settings.behavior, systemPrompt: e.target.value } })
            }
          />
        </div>
        <div className="field">
          <label>Непрозрачность оверлея: {Math.round(settings.behavior.overlayOpacity * 100)}%</label>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={settings.behavior.overlayOpacity}
            onChange={(e) =>
              patch({ behavior: { ...settings.behavior, overlayOpacity: Number(e.target.value) } })
            }
          />
        </div>
      </div>

      {/* База знаний */}
      <div className="section">
        <h2>База знаний (ответы по вашим материалам)</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.knowledgeBase.enabled}
            onChange={(e) => patchKb({ enabled: e.target.checked })}
          />
          Искать ответ в базе знаний (если там нет — обычный ответ)
        </label>

        <div className="row">
          <div className="field">
            <label>Тип поиска</label>
            <select
              value={settings.knowledgeBase.searchMode}
              onChange={(e) => patchKb({ searchMode: e.target.value as KnowledgeSearchMode })}
            >
              <option value="hybrid">Гибридный (смысл + слова) — рекоменд.</option>
              <option value="semantic">Семантический (по смыслу)</option>
              <option value="lexical">Лексический (по словам, офлайн)</option>
            </select>
          </div>
          {settings.knowledgeBase.searchMode !== 'lexical' && (
            <div className="field">
              <label>Модель эмбеддингов</label>
              <select
                value={embCustom ? '__custom__' : settings.knowledgeBase.embeddingModel}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setEmbCustom(true)
                  } else {
                    setEmbCustom(false)
                    patchKb({ embeddingModel: e.target.value })
                  }
                }}
              >
                {EMBEDDING_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {!embCustom &&
                  !EMBEDDING_MODELS.some(
                    (m) => m.id === settings.knowledgeBase.embeddingModel
                  ) && (
                    <option value={settings.knowledgeBase.embeddingModel}>
                      {settings.knowledgeBase.embeddingModel} (текущая)
                    </option>
                  )}
                <option value="__custom__">✏️ Другая модель…</option>
              </select>
              {embCustom && (
                <input
                  type="text"
                  placeholder="ID embedding-модели, напр. baai/bge-m3"
                  value={settings.knowledgeBase.embeddingModel}
                  onChange={(e) => patchKb({ embeddingModel: e.target.value })}
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
        </div>
        {settings.knowledgeBase.searchMode !== 'lexical' && (
          <div className="hint">
            Семантика находит ответ, даже если вопрос задан «своими словами». Эмбеддинги идут
            по ключу AllTokens (у подписки ChatGPT/Codex эндпоинта эмбеддингов нет), считаются
            один раз и кешируются. Без ключа — автоматический откат на лексический поиск.
          </div>
        )}

        {settings.knowledgeBase.searchMode !== 'lexical' && provider.kind !== 'apikey' && (
          <div className="field">
            <label>API-ключ AllTokens для эмбеддингов {hasKey && '· сохранён ✓'}</label>
            <div className="row">
              <input
                type="password"
                placeholder={hasKey ? '•••••••• (оставьте пустым, чтобы не менять)' : 'sk-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                className="btn"
                style={{ flex: '0 0 auto' }}
                onClick={saveAllTokensKey}
                disabled={!apiKey.trim()}
              >
                Сохранить ключ
              </button>
            </div>
            <div className="hint">
              Вы отвечаете через «{PROVIDER_LABELS[provider.kind]}», но эмбеддинги считаются по
              ключу AllTokens. Введите ключ здесь — семантический поиск заработает независимо от
              провайдера ответов.
            </div>
          </div>
        )}

        {docs.length > 0 ? (
          <div className="kb-list">
            {docs.map((d) => (
              <div className={`kb-item ${editingId === d.id ? 'editing' : ''}`} key={d.id}>
                <span className="kb-title">📄 {d.title}</span>
                <span className="kb-meta">{Math.max(1, Math.round(d.chars / 1000))}k симв.</span>
                <button className="icon-btn" title="Редактировать" onClick={() => void startEdit(d)}>
                  ✎
                </button>
                <button
                  className="icon-btn"
                  title="Удалить"
                  onClick={() => void window.api.kbRemove(d.id)}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="hint">
              Всего: {docs.length} док., ~{Math.round(kbTotalChars / 1000)}k символов.
            </div>
          </div>
        ) : (
          <div className="hint">
            Пока пусто. Добавьте текст или файл — и ответы будут учитывать эти материалы.
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>
            {editingId
              ? '✎ Редактирование документа'
              : 'Добавить текст (конспект, теория, легенда для собеседования…)'}
          </label>
          <input
            type="text"
            placeholder="Название (необязательно)"
            value={kbTitle}
            onChange={(e) => setKbTitle(e.target.value)}
          />
          <textarea
            rows={4}
            placeholder="Вставьте текст материала…"
            value={kbText}
            onChange={(e) => setKbText(e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn" onClick={importKbFile} disabled={!!editingId}>
            📎 Добавить файл (.txt / .md / .pdf)
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {editingId ? (
              <button className="btn ghost" onClick={cancelEdit}>
                Отмена
              </button>
            ) : (
              docs.length > 0 && (
                <button className="btn ghost" onClick={() => void window.api.kbClear()}>
                  Очистить всё
                </button>
              )
            )}
            <button className="btn primary" onClick={saveKb} disabled={!kbText.trim()}>
              {editingId ? 'Сохранить изменения' : 'Добавить текст'}
            </button>
          </div>
        </div>
        {kbMsg && <div className="status ok">{kbMsg}</div>}
      </div>

      {/* Хоткеи */}
      <div className="section">
        <h2>Горячие клавиши</h2>
        {(
          [
            ['toggleOverlay', 'Показать/скрыть оверлей'],
            ['captureRegion', 'Выделить область → вопрос'],
            ['captureScreen', 'Скриншот экрана → вопрос'],
            ['askLastQuestion', 'Ответ по последнему вопросу'],
            ['toggleListening', 'Слушание вкл/выкл'],
            ['panicHide', 'Паника (скрыть)'],
            ['toggleClickThrough', 'Сквозной режим вкл/выкл'],
            ['prevAnswer', 'Предыдущий ответ'],
            ['nextAnswer', 'Следующий ответ']
          ] as const
        ).map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input
              type="text"
              value={settings.hotkeys[key]}
              onChange={(e) => patch({ hotkeys: { ...settings.hotkeys, [key]: e.target.value } })}
            />
          </div>
        ))}
        <div className="hint">
          Формат Electron-акселераторов, напр. <code>Control+Shift+S</code>. Изменения применяются
          после сохранения.
        </div>
      </div>

      {/* Согласие */}
      <div className="section">
        <h2>Приватность и ответственность</h2>
        <div className="warn-box">
          Запись и распознавание разговора может подпадать под законы о согласии на запись
          (в т.ч. в РФ/ЕС). Используйте функцию слушания ответственно и только там, где это
          допустимо. Стелс-режим скрывает окно от программного захвата экрана, но не от
          физической камеры.
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.consentAcknowledged}
            onChange={(e) => patch({ consentAcknowledged: e.target.checked })}
          />
          Я понимаю и принимаю ответственность за использование
        </label>
      </div>

      <div className="actions">
        {saved && <span className="status ok">Сохранено</span>}
        <button className="btn" onClick={() => void save(false)}>
          Сохранить
        </button>
        {!settings.onboardingComplete && (
          <button className="btn primary" onClick={() => void save(true)}>
            Завершить настройку
          </button>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)
