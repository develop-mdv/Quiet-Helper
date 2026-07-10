import type { ProviderConfig } from '@shared/types'
import type { LLMProvider } from './provider'
import { OpenAiCompatProvider } from './alltokens'
import { GoogleOAuthProvider } from './oauth/google'
import { AnthropicOAuthProvider } from './oauth/anthropic'
import { ChatGptCodexProvider } from './oauth/chatgpt-codex'
import { secretStore, SECRET_KEYS } from '../secrets'

export class ProviderNotConfiguredError extends Error {}

/** Создаёт активный провайдер по конфигу настроек и сохранённым секретам. */
export function buildProvider(config: ProviderConfig): LLMProvider {
  switch (config.kind) {
    case 'apikey': {
      const apiKey = secretStore.get(SECRET_KEYS.alltokensApiKey)
      if (!apiKey) {
        throw new ProviderNotConfiguredError(
          'Не задан API-ключ. Откройте настройки и введите ключ AllTokens.'
        )
      }
      return new OpenAiCompatProvider({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.model
      })
    }
    case 'oauth-google':
      return new GoogleOAuthProvider({ model: config.model })
    case 'oauth-anthropic':
      return new AnthropicOAuthProvider({ model: config.model })
    case 'oauth-chatgpt':
      return new ChatGptCodexProvider({ model: config.model })
    default: {
      const _exhaustive: never = config
      throw new Error(`Неизвестный провайдер: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** Возвращает model из конфига (для передачи в streamChat). */
export function modelOf(config: ProviderConfig): string {
  return config.model
}
