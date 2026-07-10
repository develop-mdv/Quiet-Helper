import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, basename, extname } from 'path'
import { readFile } from 'fs/promises'
import type { KnowledgeDocMeta } from '@shared/types'
import { extractPdfText } from './pdf'

interface StoredDoc extends KnowledgeDocMeta {}

/**
 * Хранилище базы знаний: метаданные в index.json, текст каждого документа —
 * отдельным файлом {id}.txt в userData/knowledge.
 */
class KnowledgeStore {
  private dir = ''
  private indexPath = ''
  private index: StoredDoc[] = []

  init(): void {
    this.dir = join(app.getPath('userData'), 'knowledge')
    this.indexPath = join(this.dir, 'index.json')
    mkdirSync(this.dir, { recursive: true })
    try {
      if (existsSync(this.indexPath)) {
        this.index = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
      }
    } catch (err) {
      console.error('[kb] load index failed:', err)
      this.index = []
    }
  }

  private persistIndex(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8')
  }

  private docPath(id: string): string {
    return join(this.dir, `${id}.txt`)
  }

  list(): KnowledgeDocMeta[] {
    return this.index.map((m) => ({ ...m }))
  }

  totalChars(): number {
    return this.index.reduce((n, m) => n + m.chars, 0)
  }

  addText(title: string, text: string, source: 'text' | 'file' = 'text'): KnowledgeDocMeta {
    const clean = text.trim()
    if (!clean) throw new Error('Пустой текст — нечего добавлять.')
    const meta: StoredDoc = {
      id: randomUUID(),
      title: title.trim() || 'Без названия',
      chars: clean.length,
      addedAt: Date.now(),
      source
    }
    writeFileSync(this.docPath(meta.id), clean, 'utf-8')
    this.index.push(meta)
    this.persistIndex()
    return { ...meta }
  }

  /** Импортирует файл: .txt/.md как текст, .pdf через pdfjs. */
  async importFile(filePath: string): Promise<KnowledgeDocMeta> {
    const ext = extname(filePath).toLowerCase()
    let text = ''
    if (ext === '.pdf') {
      text = await extractPdfText(await readFile(filePath))
    } else if (['.txt', '.md', '.markdown', '.text', '.json', '.csv'].includes(ext)) {
      text = await readFile(filePath, 'utf-8')
    } else {
      throw new Error(`Формат ${ext || '?'} не поддерживается. Используйте .txt, .md или .pdf.`)
    }
    if (!text.trim()) {
      throw new Error('Из файла не удалось извлечь текст (возможно, это скан без текстового слоя).')
    }
    return this.addText(basename(filePath), text, 'file')
  }

  getText(id: string): string {
    const p = this.docPath(id)
    return existsSync(p) ? readFileSync(p, 'utf-8') : ''
  }

  /** Редактирование документа: новое название и/или текст. */
  update(id: string, title: string, text: string): KnowledgeDocMeta {
    const meta = this.index.find((m) => m.id === id)
    if (!meta) throw new Error('Документ не найден.')
    const clean = text.trim()
    if (!clean) throw new Error('Пустой текст — нечего сохранять.')
    writeFileSync(this.docPath(id), clean, 'utf-8')
    meta.title = title.trim() || meta.title
    meta.chars = clean.length
    this.persistIndex()
    return { ...meta }
  }

  /** Все документы с текстом (для ретривера). */
  getDocs(): { meta: KnowledgeDocMeta; text: string }[] {
    return this.index.map((meta) => ({ meta, text: this.getText(meta.id) }))
  }

  remove(id: string): void {
    this.index = this.index.filter((m) => m.id !== id)
    try {
      rmSync(this.docPath(id), { force: true })
    } catch {
      /* ignore */
    }
    this.persistIndex()
  }

  clear(): void {
    for (const m of this.index) {
      try {
        rmSync(this.docPath(m.id), { force: true })
      } catch {
        /* ignore */
      }
    }
    this.index = []
    this.persistIndex()
  }

  isEmpty(): boolean {
    return this.index.length === 0
  }
}

export const knowledgeStore = new KnowledgeStore()
