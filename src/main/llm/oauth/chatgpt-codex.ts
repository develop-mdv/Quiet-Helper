import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { LLMProvider, ProviderTestResult, StreamChatParams } from '../provider'
import type { ChatMessage } from '@shared/types'

/**
 * ChatGPT через Codex OAuth («Sign in with ChatGPT»).
 *
 * Режим codex-cli: переиспользуем готовый логин Codex CLI из ~/.codex/auth.json
 * и обращаемся к бэкенду Codex (https://chatgpt.com/backend-api/codex/responses),
 * который списывается с подписки ChatGPT.
 *
 * ВАЖНО: путь неофициальный для сторонних приложений. Запрос имитирует форму
 * Codex CLI (заголовки/instructions); OpenAI может изменить проверку в любой момент,
 * и тогда этот файл нужно будет обновить. Только личный аккаунт, без пула токенов.
 */

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/** Рекомендуемая по умолчанию модель для ChatGPT-аккаунта (GPT-5.6 Sol, GA июль 2026). */
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'

/** Модели Codex, которые бэкенд ChatGPT-аккаунта уже не принимает (свёрнуты в пользу GPT-5.6). */
const DEPRECATED_CODEX_MODELS = new Set([
  'gpt-5-codex',
  'gpt-5',
  'gpt-5.1-codex',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  // Голый алиас gpt-5.6 Codex-бэкенд отклоняет (400) — нужен явный -sol.
  'gpt-5.6'
])

/** Заменяет пустую/устаревшую модель на поддерживаемую, иначе оставляет как есть. */
export function normalizeCodexModel(model?: string): string {
  const m = (model ?? '').trim()
  if (!m || DEPRECATED_CODEX_MODELS.has(m)) return DEFAULT_CODEX_MODEL
  return m
}

interface CodexAuth {
  access_token: string
  account_id?: string
}

function codexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json')
}

/** Читает токен из ~/.codex/auth.json (структура зависит от версии Codex CLI). */
export function readCodexAuth(): CodexAuth | null {
  const p = codexAuthPath()
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    const access =
      raw?.tokens?.access_token ?? raw?.access_token ?? raw?.OPENAI_API_KEY ?? null
    if (!access) return null
    const accountId =
      raw?.tokens?.account_id ??
      raw?.account_id ??
      accountIdFromJwt(raw?.tokens?.id_token ?? raw?.id_token)
    return { access_token: access, account_id: accountId ?? undefined }
  } catch {
    return null
  }
}

/** Достаёт chatgpt_account_id из claims id_token (JWT), если он там есть. */
function accountIdFromJwt(idToken?: string): string | null {
  if (!idToken) return null
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf-8'))
    return (
      payload?.['https://api.openai.com/auth']?.chatgpt_account_id ??
      payload?.chatgpt_account_id ??
      null
    )
  } catch {
    return null
  }
}

export function isCodexAvailable(): boolean {
  return readCodexAuth() !== null
}

export class ChatGptCodexProvider implements LLMProvider {
  readonly name = 'ChatGPT (Codex)'
  private defaultModel: string

  constructor(opts: { model: string }) {
    // Модели Codex для ChatGPT-аккаунта меняются со временем. Актуальный дефолт —
    // gpt-5.5 (рекомендованная). Устаревшие -codex-имена (напр. gpt-5-codex) бэкенд
    // отклоняет с HTTP 400, поэтому нормализуем их к поддерживаемой модели.
    this.defaultModel = normalizeCodexModel(opts.model)
  }

  private buildInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
    // Склеиваем ВСЕ system-сообщения (базовый промпт + контекст базы знаний и т.п.).
    // Иначе второй system-месседж (материалы базы) терялся, и Codex отвечал без источников.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const rest = messages.filter((m) => m.role !== 'system')
    const input = rest.map((m) => ({
      type: 'message',
      role: m.role,
      content: [
        { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content },
        ...(m.images ?? []).map((img) => ({ type: 'input_image', image_url: img.dataUrl }))
      ]
    }))
    return { instructions: system, input }
  }

  async streamChat(params: StreamChatParams): Promise<void> {
    const auth = readCodexAuth()
    if (!auth) {
      throw new Error(
        'Не найден логин Codex. Установите Codex CLI и выполните `codex login`, ' +
          'либо выберите другой провайдер в настройках.'
      )
    }
    const { instructions, input } = this.buildInput(params.messages)

    const res = await fetch(`${CODEX_BASE_URL}/responses`, {
      method: 'POST',
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
        ...(auth.account_id ? { 'chatgpt-account-id': auth.account_id } : {}),
        // Заголовки, которыми Codex CLI помечает себя. При изменениях со стороны
        // OpenAI их, возможно, придётся обновить.
        originator: 'codex_cli_rs',
        'OpenAI-Beta': 'responses=experimental',
        session_id: crypto.randomUUID(),
        accept: 'text/event-stream'
      },
      body: JSON.stringify({
        // Нормализуем и модель из настроек: устаревшие имена бэкенд отклонит.
        model: normalizeCodexModel(params.model) || this.defaultModel,
        instructions,
        input,
        stream: true,
        store: false
      })
    })

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Codex backend вернул HTTP ${res.status}. ${detail.slice(0, 200)}`)
    }

    await parseResponsesSse(res.body, params.onDelta)
  }

  async test(): Promise<ProviderTestResult> {
    if (!isCodexAvailable()) {
      return { ok: false, message: 'Логин Codex не найден (~/.codex/auth.json).' }
    }
    try {
      let out = ''
      await this.streamChat({
        model: this.defaultModel,
        messages: [{ role: 'user', content: 'Ответь одним словом: ok' }],
        onDelta: (t) => (out += t)
      })
      return { ok: true, message: `Ответ получен: ${out.trim().slice(0, 40) || '(пусто)'}` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** Разбирает SSE потока Responses API и вытаскивает текстовые дельты. */
async function parseResponsesSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (t: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) {
      for (const line of evt.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          // Responses API: событие output_text.delta несёт кусок текста.
          if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
            onDelta(json.delta)
          }
        } catch {
          // игнорируем неполные/служебные строки
        }
      }
    }
  }
}
