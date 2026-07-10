import type { TranscriptSegment } from '@shared/types'

/** Кольцевой буфер последних реплик транскрипта (для контекста ответов). */
class TranscriptBuffer {
  private segments: TranscriptSegment[] = []
  private max = 60

  add(seg: TranscriptSegment): void {
    // Обновляем существующий (не финальный) сегмент по id или добавляем новый.
    const idx = this.segments.findIndex((s) => s.id === seg.id)
    if (idx >= 0) this.segments[idx] = seg
    else this.segments.push(seg)
    if (this.segments.length > this.max) this.segments.shift()
  }

  recentText(limit = 12): string {
    return this.segments
      .slice(-limit)
      .map((s) => `${s.source === 'microphone' ? 'Я' : 'Собеседник'}: ${s.text}`)
      .join('\n')
  }

  lastQuestion(): TranscriptSegment | null {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].isQuestion) return this.segments[i]
    }
    return this.segments[this.segments.length - 1] ?? null
  }

  clear(): void {
    this.segments = []
  }
}

export const transcriptBuffer = new TranscriptBuffer()
