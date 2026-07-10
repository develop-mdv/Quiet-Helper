import OpenAI from 'openai'
import type { LLMProvider, ProviderTestResult, StreamChatParams } from './provider'
import { toOpenAiMessages } from './provider'

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
      // openai SDK по умолчанию запрещает работу вне браузера-безопасного контекста;
      // мы в main-процессе Electron (Node), поэтому всё ок.
      dangerouslyAllowBrowser: false
    })
  }

  async streamChat(params: StreamChatParams): Promise<void> {
    const stream = await this.client.chat.completions.create(
      {
        model: params.model || this.defaultModel,
        messages: toOpenAiMessages(params.messages) as never,
        stream: true
      },
      { signal: params.signal }
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) params.onDelta(delta)
    }
  }

  async test(): Promise<ProviderTestResult> {
    try {
      let received = ''
      await this.streamChat({
        model: this.defaultModel,
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
  if (err instanceof OpenAI.APIError) {
    return `HTTP ${err.status ?? '?'}: ${err.message}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}
