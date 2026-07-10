import type { LLMProvider, ProviderTestResult, StreamChatParams } from '../provider'

/**
 * Claude через OAuth подписки (Pro/Max), тот же механизм, что у Claude Code.
 * Полная реализация PKCE-флоу — этап M6.
 *
 * План реализации:
 *  1. PKCE-авторизация (claude.ai OAuth), loopback-redirect.
 *  2. Обмен кода на токен, хранение в secretStore, авто-рефреш.
 *  3. Вызов Anthropic Messages API с OAuth Bearer + заголовком anthropic-beta oauth, стриминг.
 */
export class AnthropicOAuthProvider implements LLMProvider {
  readonly name = 'Anthropic Claude (OAuth)'
  constructor(private opts: { model: string }) {}

  async streamChat(_params: StreamChatParams): Promise<void> {
    throw new Error('OAuth Anthropic ещё не подключён (этап M6). Пока используйте API-ключ AllTokens.')
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: false, message: 'OAuth Anthropic ещё не подключён (этап M6).' }
  }
}
