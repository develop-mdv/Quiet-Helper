import { settingsStore } from '../settingsStore'
import { transcribeCloud } from './cloud'
import { transcribeLocal, isWhisperAvailable } from './whisper'
import { transcribeCodex } from './codex'

/**
 * Транскрибирует один WAV-фрагмент согласно выбранному в настройках режиму STT.
 * local-whisper с фолбэком на облако, если Whisper не установлен.
 */
export async function transcribe(wavBase64: string): Promise<string> {
  const stt = settingsStore.get().stt
  const lang = stt.language

  switch (stt.mode) {
    case 'local-whisper':
      if (isWhisperAvailable(stt.whisperModel)) {
        return transcribeLocal(wavBase64, stt.whisperModel, lang)
      }
      // Тихий фолбэк на облако, чтобы «слушание» работало из коробки при наличии ключа.
      return transcribeCloud(wavBase64, lang)
    case 'codex':
      // Встроенный ASR Codex (whisper-1) по подписке ChatGPT.
      return transcribeCodex(wavBase64, lang)
    case 'cloud-alltokens':
      return transcribeCloud(wavBase64, lang)
    case 'web-speech':
      // web-speech обрабатывается в рендерере; сюда не должно приходить.
      return transcribeCloud(wavBase64, lang)
    default:
      return transcribeCloud(wavBase64, lang)
  }
}
