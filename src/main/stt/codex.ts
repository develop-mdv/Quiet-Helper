import { readCodexAuth } from '../llm/oauth/chatgpt-codex'

/**
 * Транскрибация через встроенный ASR Codex/ChatGPT (модель whisper-1),
 * по токену подписки ChatGPT — тот же логин, что и для ответов Codex.
 *
 * Эндпоинт one-shot диктовки Codex Desktop: POST https://chatgpt.com/backend-api/transcribe
 * (multipart, поле `file` с WAV, опц. `language`), ответ `{"text": "..."}`.
 * Авторизация: Authorization: Bearer <access_token> + ChatGPT-Account-Id.
 *
 * ВАЖНО: эндпоинт неофициальный (реверс Codex Desktop) и может измениться со стороны
 * OpenAI. Требует установленного Codex и `codex login`.
 */
const CODEX_TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe'

// Заголовки, которыми Codex Desktop проходит Cloudflare-защиту chatgpt.com.
// Значения повторяют рабочий референс (codex-asr): originator + User-Agent вида
// «Codex Desktop/<версия> (<OS>; <arch>)». Без них эндпоинт отдаёт 403 (челлендж CF).
// Версию можно переопределить через CODEX_UA_VERSION.
const CODEX_DESKTOP_VERSION = process.env.CODEX_UA_VERSION || '26.429.30905'

function codexUserAgent(): string {
  const osName =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  const arch =
    process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch
  return `Codex Desktop/${CODEX_DESKTOP_VERSION} (${osName}; ${arch})`
}

export function isCodexTranscribeAvailable(): boolean {
  return readCodexAuth() !== null
}

export async function transcribeCodex(wavBase64: string, language: string): Promise<string> {
  const auth = readCodexAuth()
  if (!auth) {
    throw new Error(
      'Не найден логин Codex для транскрибации. Установите Codex CLI и выполните `codex login`.'
    )
  }

  const bytes = Buffer.from(wavBase64, 'base64')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav')
  if (language && language !== 'auto') form.append('language', language)

  const res = await fetch(CODEX_TRANSCRIBE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      Originator: 'Codex Desktop',
      'User-Agent': codexUserAgent(),
      ...(auth.account_id ? { 'ChatGPT-Account-Id': auth.account_id } : {})
    },
    body: form
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 403) {
      throw new Error(
        'Codex транскрибация: 403 (Cloudflare заблокировал запрос). Возможно, изменились ' +
          'требования chatgpt.com. Попробуйте обновить Codex или переключите STT на локальный ' +
          'Whisper / облако AllTokens.'
      )
    }
    throw new Error(`Codex транскрибация: HTTP ${res.status}. ${detail.slice(0, 160)}`)
  }

  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}
