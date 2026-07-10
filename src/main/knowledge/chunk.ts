// Чанкинг и токенизация, общие для лексического (BM25) и семантического поиска.

export const CHUNK_SIZE = 1200

/** Режет текст на куски по абзацам до ~CHUNK_SIZE символов. */
export function chunkText(text: string): string[] {
  const paras = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let buf = ''
  const flush = (): void => {
    const t = buf.trim()
    if (t) chunks.push(t)
    buf = ''
  }
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > CHUNK_SIZE && buf) flush()
    buf += (buf ? '\n\n' : '') + p
    if (buf.length >= CHUNK_SIZE) flush()
  }
  flush()
  return chunks
}

const STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее',
  'мне', 'было', 'вот', 'от', 'меня', 'о', 'из', 'ему', 'этот', 'это', 'эта', 'для', 'или',
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'as',
  'at', 'by', 'be', 'this', 'that', 'it', 'from', 'how', 'what', 'why', 'do', 'does'
])

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return matches.filter((t) => t.length > 1 && !STOPWORDS.has(t))
}
