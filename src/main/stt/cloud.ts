import { secretStore, SECRET_KEYS } from '../secrets'
import { settingsStore } from '../settingsStore'
import { DEFAULT_ALLTOKENS_BASE_URL, DEFAULT_MODEL } from '@shared/types'

/**
 * Облачная транскрибация через мультимодальную модель AllTokens.
 * Отдельного /audio/transcriptions у AllTokens нет — отправляем аудио как
 * input_audio в chat/completions и просим расшифровать дословно.
 */
export async function transcribeCloud(wavBase64: string, language: string): Promise<string> {
  const apiKey = secretStore.get(SECRET_KEYS.alltokensApiKey)
  if (!apiKey) {
    throw new Error('Для облачной транскрибации нужен API-ключ AllTokens (задайте в настройках).')
  }
  const provider = settingsStore.get().provider
  const baseUrl = provider.kind === 'apikey' ? provider.baseUrl : DEFAULT_ALLTOKENS_BASE_URL
  const model = provider.kind === 'apikey' ? provider.model : DEFAULT_MODEL

  const langHint =
    language && language !== 'auto' ? ` Язык аудио: ${language}.` : ''

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Расшифруй речь на аудио дословно. Верни только текст без комментариев.' +
                langHint
            },
            {
              type: 'input_audio',
              input_audio: { data: wavBase64, format: 'wav' }
            }
          ]
        }
      ]
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AllTokens транскрибация: HTTP ${res.status}. ${detail.slice(0, 160)}`)
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}
