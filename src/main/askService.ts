import { randomUUID } from 'crypto'
import type { AskOptions, ChatImage, ChatMessage, StreamEvent } from '@shared/types'
import { settingsStore } from './settingsStore'
import { buildProvider } from './llm/router'
import { transcriptBuffer } from './transcriptBuffer'
import { describeError } from './llm/alltokens'
import { buildKnowledgeContext, knowledgeNeedsQuery } from './knowledge/retrieve'

/** Инструкция модели, как использовать материалы базы знаний. */
const KB_INSTRUCTION =
  'Ниже — материалы из личной базы знаний пользователя. Если в них есть ответ на вопрос — ' +
  'отвечай СТРОГО по этим материалам и в конце добавь отдельной строкой «📚 Источник: <названия>». ' +
  'Если ответа в материалах нет — ответь как обычно, на основе своих знаний, и НЕ добавляй строку про источник.'

type Emit = (event: StreamEvent) => void

/** Короткая подпись вопроса для истории ответов в оверлее. */
function labelFor(opts: AskOptions): string {
  if (opts.prompt?.trim()) return opts.prompt.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (opts.images && opts.images.length > 0) return '📷 Экран'
  if (opts.includeTranscript) return '💬 Из разговора'
  return 'Вопрос'
}

/** Фиксированная инструкция по формату, добавляется к системному промпту всегда. */
const FORMAT_GUIDE =
  'Формат ответа: Markdown. Всю математику оформляй в LaTeX внутри $ … $ (в строке) или ' +
  '$$ … $$ (отдельным блоком) — НЕ используй \\[ \\] и \\( \\). Итоговый ответ выделяй, ' +
  'например $\\boxed{…}$. Код — в ограждённых блоках с указанием языка. Отвечай по существу.'

/** Управляет запросами к LLM: сборка сообщений, стриминг, отмена. */
class AskService {
  private active = new Map<string, AbortController>()

  async ask(opts: AskOptions, emit: Emit): Promise<string> {
    const requestId = randomUUID()
    const settings = settingsStore.get()

    const messages: ChatMessage[] = [
      { role: 'system', content: `${settings.behavior.systemPrompt}\n\n${FORMAT_GUIDE}` }
    ]

    let userText = opts.prompt?.trim() ?? ''

    if (opts.includeTranscript) {
      const ctx = transcriptBuffer.recentText()
      if (ctx) {
        userText =
          `Недавний разговор:\n${ctx}\n\n` +
          (userText || 'Ответь на последний вопрос собеседника, обращённый ко мне.')
      }
    }

    if (!userText && (!opts.images || opts.images.length === 0)) {
      userText = 'Помоги с тем, что на экране.'
    }
    if (opts.images && opts.images.length > 0 && !userText) {
      userText = 'На изображении — вопрос или задача. Реши/ответь кратко и по делу.'
    }

    // База знаний: ищем релевантные материалы и добавляем их как контекст.
    if (settings.knowledgeBase.enabled) {
      let query = [opts.prompt, opts.includeTranscript ? transcriptBuffer.recentText() : '']
        .filter(Boolean)
        .join('\n')
      // Вопрос только с картинки + большая база: извлекаем формулировку вопроса
      // с изображения отдельным vision-запросом, чтобы было по чему искать.
      if (!query.trim() && opts.images && opts.images.length > 0 && knowledgeNeedsQuery()) {
        try {
          query = await this.extractQueryFromImage(opts.images)
        } catch (err) {
          console.error('[kb] не удалось извлечь вопрос с картинки:', err)
        }
      }
      const kb = await buildKnowledgeContext(query || userText)
      if (kb) {
        messages.push({ role: 'system', content: `${KB_INSTRUCTION}\n\n${kb.text}` })
      }
    }

    messages.push({ role: 'user', content: userText, images: opts.images })

    const controller = new AbortController()
    this.active.set(requestId, controller)
    emit({ type: 'start', requestId, title: labelFor(opts) })

    let full = ''
    try {
      const provider = buildProvider(settings.provider)
      await provider.streamChat({
        model: settings.provider.model,
        messages,
        signal: controller.signal,
        onDelta: (t) => {
          full += t
          emit({ type: 'delta', requestId, text: t })
        }
      })
      emit({ type: 'done', requestId })
    } catch (err) {
      if (controller.signal.aborted) {
        emit({ type: 'done', requestId })
      } else {
        emit({ type: 'error', requestId, message: describeError(err) })
      }
    } finally {
      this.active.delete(requestId)
    }
    return requestId
  }

  /** Быстрый vision-запрос: извлекает формулировку вопроса с картинки для поиска в базе. */
  private async extractQueryFromImage(images: ChatImage[]): Promise<string> {
    const settings = settingsStore.get()
    const provider = buildProvider(settings.provider)
    let out = ''
    await provider.streamChat({
      model: settings.provider.model,
      messages: [
        {
          role: 'system',
          content: 'Ты извлекаешь текст вопроса/задачи с изображения для поиска по базе знаний.'
        },
        {
          role: 'user',
          content:
            'Верни ТОЛЬКО формулировку вопроса и ключевые термины с изображения одной строкой, ' +
            'без решения и пояснений.',
          images
        }
      ],
      onDelta: (t) => {
        out += t
      }
    })
    return out.trim().slice(0, 500)
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort()
    this.active.delete(requestId)
  }

  cancelAll(): void {
    for (const c of this.active.values()) c.abort()
    this.active.clear()
  }
}

export const askService = new AskService()
