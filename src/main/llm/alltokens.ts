import OpenAI from 'openai'
import type { LLMProvider, ProviderTestResult, StreamChatParams } from './provider'
import { toOpenAiMessages } from './provider'
import { apiErrorStatus, runApiRequest } from '../apiRequest'

/**
 * OpenAI-совместимый клиент. По умолчанию указывает на AllTokens
 * (https://api.alltokens.ru/api/v1), но подходит для любого OpenAI-совместимого
 * эндпоинта (OpenAI, OpenRouter и т.п.).
 */
export class OpenAiCompatProvider implements LLMProvider {
  readonly name: string
  private client: OpenAI
  private defaultModel: string

  constructor(opts: { baseUrl: string; apiKey: string; model: string; name?: string }) {
    this.name = opts.name ?? 'AllTokens'
    this.defaultModel = opts.model
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      // Retries are coordinated process-wide so all API-key consumers share
      // the same concurrency limit and Retry-After pause.
      maxRetries: 0,
      // openai SDK по умолчанию запрещает работу вне браузера-безопасного контекста;
      // мы в main-процессе Electron (Node), поэтому всё ок.
      dangerouslyAllowBrowser: false
    })
  }

  async streamChat(params: StreamChatParams): Promise<void> {
    let emitted = false
    await runApiRequest(
      async () => {
        const stream = await this.client.chat.completions.create(
          {
            model: params.model || this.defaultModel,
            messages: toOpenAiMessages(params.messages) as never,
            // Без явного лимита AllTokens может зарезервировать слишком большую
            // потенциальную стоимость и вернуть 429 даже для короткого ответа.
            max_tokens: params.maxTokens ?? 1600,
            stream: true
          },
          { signal: params.signal }
        )

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            emitted = true
            params.onDelta(delta)
          }
        }
      },
      { signal: params.signal, retryIf: () => !emitted }
    )
  }

  async test(): Promise<ProviderTestResult> {
    try {
      let received = ''
      await this.streamChat({
        model: this.defaultModel,
        maxTokens: 16,
        messages: [{ role: 'user', content: 'Ответь одним словом: ok' }],
        onDelta: (t) => {
          received += t
        }
      })
      return { ok: true, message: `Ответ получен: ${received.trim().slice(0, 40) || '(пусто)'}` }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  }
}

export function describeError(err: unknown): string {
  if (apiErrorStatus(err) === 429) {
    return 'API временно занят (HTTP 429): автоматические повторы не помогли. Подождите немного и повторите запрос.'
  }
  if (err instanceof OpenAI.APIError) {
    return `HTTP ${err.status ?? '?'}: ${err.message}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}
