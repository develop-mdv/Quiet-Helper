import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs'
import { knowledgeStore } from './store'
import { chunkText } from './chunk'
import { embedTexts, currentEmbeddingModel } from './embeddings'

/**
 * Семантический индекс: для каждого документа храним эмбеддинги его чанков в
 * {id}.emb.json рядом с текстом. Пересчитываем, если сменилась модель или изменился
 * текст (по числу символов). Эмбеддинги считаются один раз, а не на каждый запрос.
 */

interface EmbChunk {
  text: string
  vector: number[]
}
interface EmbFile {
  model: string
  chars: number
  chunks: EmbChunk[]
}

export interface IndexedChunk {
  docTitle: string
  text: string
  vector: number[]
}

const EMB_SUFFIX = '.emb.json'

function kbDir(): string {
  return join(app.getPath('userData'), 'knowledge')
}
function embPath(id: string): string {
  return join(kbDir(), `${id}${EMB_SUFFIX}`)
}

/** Удаляет эмбеддинги документов, которых больше нет в базе. */
function pruneOrphans(validIds: Set<string>): void {
  try {
    for (const f of readdirSync(kbDir())) {
      if (!f.endsWith(EMB_SUFFIX)) continue
      const id = f.slice(0, -EMB_SUFFIX.length)
      if (!validIds.has(id)) rmSync(join(kbDir(), f), { force: true })
    }
  } catch {
    /* ignore */
  }
}

/**
 * Гарантирует свежие эмбеддинги для всех документов и возвращает все чанки с
 * векторами. Может выполнить сетевые запросы (индексация новых/изменённых документов).
 */
export async function getIndexedChunks(): Promise<IndexedChunk[]> {
  const model = currentEmbeddingModel()
  const docs = knowledgeStore.list()
  pruneOrphans(new Set(docs.map((d) => d.id)))

  const result: IndexedChunk[] = []
  for (const meta of docs) {
    const p = embPath(meta.id)
    let emb: EmbFile | null = null
    if (existsSync(p)) {
      try {
        emb = JSON.parse(readFileSync(p, 'utf-8')) as EmbFile
      } catch {
        emb = null
      }
    }
    // Пересчёт при отсутствии/смене модели/изменении текста.
    if (!emb || emb.model !== model || emb.chars !== meta.chars) {
      const text = knowledgeStore.getText(meta.id)
      const chunks = chunkText(text)
      if (chunks.length === 0) continue
      const vectors = await embedTexts(chunks)
      emb = {
        model,
        chars: meta.chars,
        chunks: chunks.map((t, i) => ({ text: t, vector: vectors[i] ?? [] }))
      }
      writeFileSync(p, JSON.stringify(emb), 'utf-8')
    }
    for (const c of emb.chunks) {
      result.push({ docTitle: meta.title, text: c.text, vector: c.vector })
    }
  }
  return result
}
