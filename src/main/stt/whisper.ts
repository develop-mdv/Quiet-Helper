import { app } from 'electron'
import { existsSync } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

/**
 * Локальная транскрибация через whisper.cpp (офлайн, приватно, бесплатно).
 *
 * Мы вызываем бинарник whisper-cli (whisper.cpp) с ggml-моделью. Бинарник и модели
 * не входят в репозиторий — их ставит менеджер моделей (этап M4) в resources/whisper.
 * Пути можно переопределить переменными окружения WHISPER_BIN / WHISPER_MODEL.
 *
 * Если бинарник/модель не найдены — бросаем понятную ошибку, и пользователь может
 * переключиться на облачный режим в настройках.
 */

function whisperBin(): string {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return join(base, 'whisper', exe)
}

function whisperModelPath(model: string): string {
  if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'whisper-models', `ggml-${model}.bin`)
}

export function isWhisperAvailable(model: string): boolean {
  return existsSync(whisperBin()) && existsSync(whisperModelPath(model))
}

export async function transcribeLocal(
  wavBase64: string,
  model: string,
  language: string
): Promise<string> {
  const bin = whisperBin()
  const modelPath = whisperModelPath(model)
  if (!existsSync(bin) || !existsSync(modelPath)) {
    throw new Error(
      'Локальный Whisper не установлен. Установите модель в настройках или переключитесь ' +
        'на облачную транскрибацию (AllTokens).'
    )
  }

  const tmpWav = join(tmpdir(), `qh-${randomUUID()}.wav`)
  await writeFile(tmpWav, Buffer.from(wavBase64, 'base64'))

  const args = [
    '-m', modelPath,
    '-f', tmpWav,
    '-nt', // без таймстемпов
    '-otxt', // вывод в stdout/файл
    ...(language && language !== 'auto' ? ['-l', language] : ['-l', 'auto'])
  ]

  try {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, args)
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d.toString()))
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`whisper-cli завершился с кодом ${code}: ${stderr.slice(0, 200)}`))
      })
    })
    return out.trim()
  } finally {
    await unlink(tmpWav).catch(() => {})
  }
}
