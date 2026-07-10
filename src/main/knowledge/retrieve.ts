import { settingsStore } from '../settingsStore'
import { knowledgeStore } from './store'
import { chunkText, tokenize } from './chunk'
import { isEmbeddingConfigured, embedOne, cosine } from './embeddings'
import { getIndexedChunks } from './semantic'
import type { KnowledgeDocMeta } from '@shared/types'

const INCLUDE_ALL_UNDER = 20000 // символов — маленькую базу подаём целиком
const RETRIEVE_BUDGET = 16000 // бюджет контекста для найденных кусков
const SEMANTIC_MIN = 0.3 // минимальная косинусная близость, чтобы считать кусок релевантным

export interface KnowledgeContext {
  text: string
  sources: string[]
}

/**
 * Нужен ли текстовый запрос для поиска. true, если база включена, непуста и
 * достаточно большая (маленькую подаём целиком и без запроса). Используется, чтобы
 * решать, стоит ли извлекать вопрос из картинки перед поиском.
 */
export function knowledgeNeedsQuery(): boolean {
  const kb = settingsStore.get().knowledgeBase
  if (!kb.enabled || knowledgeStore.isEmpty()) return false
  return knowledgeStore.totalChars() > INCLUDE_ALL_UNDER
}

interface SimpleChunk {
  docTitle: string
  text: string
}

/** BM25-оценки для набора чанков относительно терминов запроса. */
function bm25Scores(chunkTokens: string[][], qTerms: string[]): number[] {
  const N = chunkTokens.length
  if (N === 0 || qTerms.length === 0) return new Array(N).fill(0)
  const df = new Map<string, number>()
  for (const term of qTerms) {
    let c = 0
    for (const toks of chunkTokens) if (toks.includes(term)) c++
    df.set(term, c)
  }
  const avgdl = chunkTokens.reduce((s, t) => s + t.length, 0) / N
  const k1 = 1.5
  const b = 0.75
  return chunkTokens.map((toks) => {
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const term of qTerms) {
      const f = tf.get(term) ?? 0
      if (!f) continue
      const n = df.get(term) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      const denom = f + k1 * (1 - b + (b * toks.length) / avgdl)
      score += idf * ((f * (k1 + 1)) / denom)
    }
    return score
  })
}

/** Собирает контекст из отобранных кусков в рамках бюджета. */
function assemble(chunks: SimpleChunk[]): KnowledgeContext {
  const parts: string[] = []
  const sources = new Set<string>()
  let used = 0
  for (const c of chunks) {
    if (used + c.text.length > RETRIEVE_BUDGET && parts.length > 0) break
    parts.push(`[Документ: ${c.docTitle}]\n${c.text}`)
    sources.add(c.docTitle)
    used += c.text.length
    if (used >= RETRIEVE_BUDGET) break
  }
  return { text: parts.join('\n\n'), sources: [...sources] }
}

/** Лексический поиск (BM25). */
function lexicalContext(
  docs: { meta: KnowledgeDocMeta; text: string }[],
  query: string
): KnowledgeContext | null {
  const chunks: SimpleChunk[] = docs.flatMap((d) =>
    chunkText(d.text).map((text) => ({ docTitle: d.meta.title, text }))
  )
  const qTerms = [...new Set(tokenize(query))]
  const scores = bm25Scores(
    chunks.map((c) => tokenize(c.text)),
    qTerms
  )
  const ranked = chunks
    .map((c, i) => ({ c, score: scores[i] }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return null
  return assemble(ranked.map((r) => r.c))
}

/** Семантический (эмбеддинги) или гибридный (эмбеддинги + BM25) поиск. */
async function semanticContext(query: string, hybrid: boolean): Promise<KnowledgeContext | null> {
  const chunks = await getIndexedChunks()
  if (chunks.length === 0) return null
  const qvec = await embedOne(query)
  if (qvec.length === 0) return null

  const sem = chunks.map((c) => cosine(qvec, c.vector))
  const bm = hybrid
    ? bm25Scores(
        chunks.map((c) => tokenize(c.text)),
        [...new Set(tokenize(query))]
      )
    : new Array<number>(chunks.length).fill(0)

  const maxSem = Math.max(...sem, 1e-9)
  const maxBm = Math.max(...bm, 1e-9)

  const ranked = chunks
    .map((c, i) => {
      const relevant = sem[i] >= SEMANTIC_MIN || (hybrid && bm[i] > 0)
      const score = hybrid ? 0.5 * (sem[i] / maxSem) + 0.5 * (bm[i] / maxBm) : sem[i]
      return { c: { docTitle: c.docTitle, text: c.text }, relevant, score }
    })
    .filter((x) => x.relevant)
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return null
  return assemble(ranked.map((r) => r.c))
}

/**
 * Собирает контекст из базы знаний под запрос.
 * - Маленькую базу подаёт целиком.
 * - Крупную — ищет по режиму (lexical / semantic / hybrid). Семантика требует ключа
 *   AllTokens; без него — фолбэк на лексический. Если релевантного нет — null (обычный ответ).
 */
export async function buildKnowledgeContext(query: string): Promise<KnowledgeContext | null> {
  const kb = settingsStore.get().knowledgeBase
  if (!kb.enabled || knowledgeStore.isEmpty()) return null
  const docs = knowledgeStore.getDocs().filter((d) => d.text.trim())
  if (docs.length === 0) return null

  const total = docs.reduce((s, d) => s + d.text.length, 0)

  // Небольшая база — целиком.
  if (total <= INCLUDE_ALL_UNDER) {
    const text = docs.map((d) => `[Документ: ${d.meta.title}]\n${d.text.trim()}`).join('\n\n')
    return { text, sources: docs.map((d) => d.meta.title) }
  }

  // Без текстового запроса (например, вопрос только с картинки) искать нечего.
  if (!query.trim()) return null

  let mode = kb.searchMode
  if ((mode === 'semantic' || mode === 'hybrid') && !isEmbeddingConfigured()) {
    mode = 'lexical' // фолбэк без ключа AllTokens
  }

  if (mode === 'lexical') return lexicalContext(docs, query)

  try {
    return await semanticContext(query, mode === 'hybrid')
  } catch (err) {
    console.error('[kb] семантический поиск не удался, фолбэк на лексический:', err)
    return lexicalContext(docs, query)
  }
}
