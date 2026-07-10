import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

/**
 * Простое JSON-хранилище настроек в userData.
 * Собственная реализация вместо electron-store, чтобы не тянуть ESM/CJS-зависимость.
 */
class SettingsStore {
  private filePath = ''
  private cache: Settings = DEFAULT_SETTINGS
  private listeners = new Set<(s: Settings) => void>()

  init(): void {
    this.filePath = join(app.getPath('userData'), 'settings.json')
    this.cache = this.load()
  }

  private load(): Settings {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        return this.merge(DEFAULT_SETTINGS, raw)
      }
    } catch (err) {
      console.error('[settings] load failed, using defaults:', err)
    }
    return structuredClone(DEFAULT_SETTINGS)
  }

  /** Глубокое слияние: сохранённые значения поверх дефолтов (для новых полей). */
  private merge(base: Settings, saved: Partial<Settings>): Settings {
    return {
      ...base,
      ...saved,
      provider: { ...(saved.provider ?? base.provider) } as Settings['provider'],
      hotkeys: { ...base.hotkeys, ...(saved.hotkeys ?? {}) },
      stt: { ...base.stt, ...(saved.stt ?? {}) },
      behavior: { ...base.behavior, ...(saved.behavior ?? {}) },
      knowledgeBase: { ...base.knowledgeBase, ...(saved.knowledgeBase ?? {}) }
    }
  }

  get(): Settings {
    return this.cache
  }

  update(patch: Partial<Settings>): Settings {
    this.cache = this.merge(this.cache, patch)
    this.persist()
    for (const l of this.listeners) l(this.cache)
    return this.cache
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
    } catch (err) {
      console.error('[settings] persist failed:', err)
    }
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

export const settingsStore = new SettingsStore()
