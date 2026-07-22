import type { ChatMessage } from '@shared/types'

export interface StreamChatParams {
  messages: ChatMessage[]
  model: string
  /** Ограничивает резерв баланса и максимальную длину ответа у API-провайдера. */
  maxTokens?: number
  signal?: AbortSignal
  onDelta: (text: string) => void
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

/**
 * Единый интерфейс LLM-провайдера. Реализации: AllTokens (API-ключ),
 * OAuth Google/Anthropic, ChatGPT через Codex.
 */
export interface LLMProvider {
  /** Человекочитаемое имя для UI/логов. */
  readonly name: string
  /** Стримит ответ по частям через onDelta. Бросает при ошибке/отмене. */
  streamChat(params: StreamChatParams): Promise<void>
  /** Быстрая проверка доступности (ключ/токен валиден). */
  test(): Promise<ProviderTestResult>
}

/** Преобразует наши ChatMessage в формат OpenAI chat/completions (с картинками). */
export function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return {
        role: m.role,
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.images.map((img) => ({
            type: 'image_url',
            image_url: { url: img.dataUrl }
          }))
        ]
      }
    }
    return { role: m.role, content: m.content }
  })
}
