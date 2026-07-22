import { secretStore, SECRET_KEYS } from '../secrets'
import { settingsStore } from '../settingsStore'
import { DEFAULT_ALLTOKENS_BASE_URL } from '@shared/types'
import { apiErrorFromResponse, runApiRequest } from '../apiRequest'

/** Есть ли ключ AllTokens для вычисления эмбеддингов. */
export function isEmbeddingConfigured(): boolean {
  return secretStore.has(SECRET_KEYS.alltokensApiKey)
}

export function currentEmbeddingModel(): string {
  return settingsStore.get().knowledgeBase.embeddingModel
}

function embeddingConfig(): { apiKey: string | null; baseUrl: string; model: string } {
  const apiKey = secretStore.get(SECRET_KEYS.alltokensApiKey)
  const provider = settingsStore.get().provider
  const baseUrl = provider.kind === 'apikey' ? provider.baseUrl : DEFAULT_ALLTOKENS_BASE_URL
  return { apiKey, baseUrl, model: currentEmbeddingModel() }
}

const BATCH = 96

/** Векторизует список текстов через OpenAI-совместимый /embeddings AllTokens. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { apiKey, baseUrl, model } = embeddingConfig()
  if (!apiKey) {
    throw new Error('Для семантического поиска нужен API-ключ AllTokens (задайте в настройках).')
  }
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const json = await runApiRequest(async () => {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: batch })
      })
      if (!res.ok) throw await apiErrorFromResponse(res, 'Эмбеддинги')
      return (await res.json()) as { data?: { embedding: number[]; index: number }[] }
    })
    const data = (json.data ?? []).slice().sort((a, b) => a.index - b.index)
    for (const d of data) out.push(d.embedding)
  }
  return out
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedTexts([text])
  return v ?? []
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
