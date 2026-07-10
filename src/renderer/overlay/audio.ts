// Аудио-пайплайн рендерера: захват микрофона и системного звука (loopback),
// VAD-сегментация на реплики, кодирование каждой реплики в 16 kHz mono WAV
// и передача в main на транскрибацию.

export type AudioSource = 'microphone' | 'system'

export interface AudioHandlers {
  onSegment: (source: AudioSource, wavBase64: string) => void
  onError: (message: string) => void
  onActive?: (source: AudioSource, active: boolean) => void
}

const TARGET_RATE = 16000
const SILENCE_RMS = 0.012 // порог тишины
const MIN_SPEECH_MS = 350 // минимальная длина реплики
const SILENCE_HANG_MS = 700 // сколько тишины ждём перед завершением реплики
const MAX_SEGMENT_MS = 15000 // страховка от бесконечной реплики

class SourceRecorder {
  private ctx: AudioContext
  private processor: ScriptProcessorNode | null = null
  private srcNode: MediaStreamAudioSourceNode | null = null
  private buffer: Float32Array[] = []
  private speaking = false
  private speechMs = 0
  private silenceMs = 0
  private inputRate: number

  constructor(
    private stream: MediaStream,
    private source: AudioSource,
    private handlers: AudioHandlers
  ) {
    this.ctx = new AudioContext()
    this.inputRate = this.ctx.sampleRate
  }

  start(): void {
    this.srcNode = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessorNode устарел, но надёжно работает в Electron/Chromium.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0))
    this.srcNode.connect(this.processor)
    // Подключаем к «немому» узлу, чтобы процессор вызывался.
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(this.ctx.destination)
  }

  private onAudio(frame: Float32Array): void {
    const frameMs = (frame.length / this.inputRate) * 1000
    const rms = computeRms(frame)

    if (rms > SILENCE_RMS) {
      if (!this.speaking) {
        this.speaking = true
        this.speechMs = 0
        this.buffer = []
        this.handlers.onActive?.(this.source, true)
      }
      this.speechMs += frameMs
      this.silenceMs = 0
      this.buffer.push(new Float32Array(frame))
      if (this.speechMs >= MAX_SEGMENT_MS) this.finish()
    } else if (this.speaking) {
      this.silenceMs += frameMs
      this.buffer.push(new Float32Array(frame))
      if (this.silenceMs >= SILENCE_HANG_MS) this.finish()
    }
  }

  private finish(): void {
    const spoke = this.speechMs
    const chunks = this.buffer
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.buffer = []
    this.handlers.onActive?.(this.source, false)
    if (spoke < MIN_SPEECH_MS || chunks.length === 0) return

    const merged = mergeFloat32(chunks)
    const down = downsample(merged, this.inputRate, TARGET_RATE)
    const wav = encodeWav(down, TARGET_RATE)
    const base64 = arrayBufferToBase64(wav)
    this.handlers.onSegment(this.source, base64)
  }

  stop(): void {
    try {
      this.processor?.disconnect()
      this.srcNode?.disconnect()
      void this.ctx.close()
      this.stream.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
  }
}

export class AudioPipeline {
  private recorders: SourceRecorder[] = []
  private running = false

  async start(opts: { mic: boolean; system: boolean }, handlers: AudioHandlers): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      if (opts.mic) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        })
        const rec = new SourceRecorder(micStream, 'microphone', handlers)
        rec.start()
        this.recorders.push(rec)
      }
      if (opts.system) {
        // getDisplayMedia требует video-трек; берём только audio (loopback),
        // видео сразу останавливаем.
        const dispStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        })
        dispStream.getVideoTracks().forEach((t) => t.stop())
        if (dispStream.getAudioTracks().length === 0) {
          handlers.onError('Системный звук недоступен (нет audio-трека в getDisplayMedia).')
        } else {
          const audioOnly = new MediaStream(dispStream.getAudioTracks())
          const rec = new SourceRecorder(audioOnly, 'system', handlers)
          rec.start()
          this.recorders.push(rec)
        }
      }
    } catch (err) {
      this.running = false
      handlers.onError(err instanceof Error ? err.message : String(err))
      this.stop()
    }
  }

  stop(): void {
    this.recorders.forEach((r) => r.stop())
    this.recorders = []
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }
}

// ---------- утилиты DSP ----------

function computeRms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input
  const ratio = from / to
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

/** 16-bit PCM WAV (mono). */
function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buffer
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
