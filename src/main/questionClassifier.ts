import { settingsStore } from './settingsStore'
import { buildProvider } from './llm/router'

/**
 * Лёгкий LLM-фильтр: последняя реплика — это вопрос/просьба, ОБРАЩЁННАЯ к пользователю,
 * на которую он должен дать содержательный ответ? Нужен, чтобы авто-ответ не срабатывал
 * на утверждения, реплики самого пользователя и болтовню.
 *
 * Возвращает true/false. При ошибке/таймауте бросает — вызывающий решает, что делать
 * (обычно: продолжить, чтобы не потерять реальный вопрос).
 */
export async function isAnswerableQuestion(text: string, context: string): Promise<boolean> {
  const settings = settingsStore.get()
  const provider = buildProvider(settings.provider)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  let out = ''
  try {
    await provider.streamChat({
      model: settings.provider.model,
      maxTokens: 8,
      signal: controller.signal,
      messages: [
        {
          role: 'system',
          content:
            'Ты — фильтр. Определи, является ли ПОСЛЕДНЯЯ реплика вопросом или просьбой, ' +
            'обращённой к пользователю, на которую он должен дать содержательный ответ ' +
            '(например, вопрос интервьюера, преподавателя, задача). Утверждения, реплики ' +
            'самого пользователя, приветствия и болтовня — это NO. Ответь строго одним словом: ' +
            'YES или NO.'
        },
        {
          role: 'user',
          content:
            `Недавний разговор:\n${context || '(нет)'}\n\n` +
            `Последняя реплика: "${text}"\n\nОтветь YES или NO.`
        }
      ],
      onDelta: (t) => {
        out += t
      }
    })
  } finally {
    clearTimeout(timer)
  }
  return /\byes\b|\bда\b/i.test(out.trim())
}
