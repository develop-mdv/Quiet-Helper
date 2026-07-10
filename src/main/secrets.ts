import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/**
 * Хранилище секретов (API-ключи, OAuth-токены) с шифрованием через safeStorage
 * (на Windows — DPAPI, привязан к учётной записи пользователя). Значения на диске
 * лежат в base64 от зашифрованного буфера.
 */
class SecretStore {
  private filePath = ''
  private cache: Record<string, string> = {}

  init(): void {
    this.filePath = join(app.getPath('userData'), 'secrets.json')
    try {
      if (existsSync(this.filePath)) {
        this.cache = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      }
    } catch (err) {
      console.error('[secrets] load failed:', err)
      this.cache = {}
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.cache), 'utf-8')
  }

  set(key: string, value: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      this.cache[key] = safeStorage.encryptString(value).toString('base64')
    } else {
      // Фолбэк без шифрования (например, если ОС не предоставляет ключницу).
      this.cache[key] = 'plain:' + Buffer.from(value, 'utf-8').toString('base64')
    }
    this.persist()
  }

  get(key: string): string | null {
    const stored = this.cache[key]
    if (!stored) return null
    try {
      if (stored.startsWith('plain:')) {
        return Buffer.from(stored.slice('plain:'.length), 'base64').toString('utf-8')
      }
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch (err) {
      console.error('[secrets] decrypt failed for', key, err)
      return null
    }
  }

  has(key: string): boolean {
    return Boolean(this.cache[key])
  }

  clear(key: string): void {
    delete this.cache[key]
    this.persist()
  }
}

export const secretStore = new SecretStore()

// Ключи секретов
export const SECRET_KEYS = {
  alltokensApiKey: 'alltokens.apiKey',
  googleOAuth: 'oauth.google',
  anthropicOAuth: 'oauth.anthropic',
  chatgptOAuth: 'oauth.chatgpt'
} as const
