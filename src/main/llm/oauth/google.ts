import type { LLMProvider, ProviderTestResult, StreamChatParams } from '../provider'

/**
 * Gemini через OAuth Google-аккаунта (легальный подписочный путь, аналог Gemini CLI /
 * Code Assist free tier). Полная реализация PKCE-флоу — этап M6.
 *
 * План реализации:
 *  1. PKCE-авторизация в системном браузере, loopback-redirect на 127.0.0.1.
 *  2. Обмен кода на access/refresh токен, хранение в secretStore, авто-рефреш.
 *  3. Вызов Gemini через Code Assist эндпоинт с OAuth Bearer, стриминг.
 */
export class GoogleOAuthProvider implements LLMProvider {
  readonly name = 'Google Gemini (OAuth)'
  constructor(private opts: { model: string }) {}

  async streamChat(_params: StreamChatParams): Promise<void> {
    throw new Error('OAuth Google ещё не подключён (этап M6). Пока используйте API-ключ AllTokens.')
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: false, message: 'OAuth Google ещё не подключён (этап M6).' }
  }
}
