import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { StreamEvent, TranscriptSegment } from '@shared/types'
import { Markdown } from './Markdown'
import { AudioPipeline, type AudioSource } from './audio'

interface AnswerEntry {
  id: string
  title: string
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}
interface HistoryState {
  entries: AnswerEntry[]
  current: number
  /** «Следовать» за новыми ответами (мы на самом свежем). */
  following: boolean
}
type HistoryAction =
  | { t: 'start'; id: string; title: string }
  | { t: 'delta'; id: string; text: string }
  | { t: 'done'; id: string }
  | { t: 'error'; id: string; message: string }
  | { t: 'prev' }
  | { t: 'next' }
  | { t: 'clear' }

function pushEntry(s: HistoryState, entry: AnswerEntry): HistoryState {
  const entries = [...s.entries, entry]
  return { entries, current: s.following ? entries.length - 1 : s.current, following: s.following }
}

function historyReducer(s: HistoryState, a: HistoryAction): HistoryState {
  switch (a.t) {
    case 'start':
      return pushEntry(s, { id: a.id, title: a.title, text: '', status: 'streaming' })
    case 'delta':
      return {
        ...s,
        entries: s.entries.map((e) => (e.id === a.id ? { ...e, text: e.text + a.text } : e))
      }
    case 'done':
      return {
        ...s,
        entries: s.entries.map((e) =>
          e.id === a.id && e.status === 'streaming' ? { ...e, status: 'done' } : e
        )
      }
    case 'error': {
      if (s.entries.some((e) => e.id === a.id)) {
        return {
          ...s,
          entries: s.entries.map((e) =>
            e.id === a.id ? { ...e, status: 'error', error: a.message } : e
          )
        }
      }
      // Ошибка без предшествующего start (например, STT) — заводим отдельную запись.
      return pushEntry(s, { id: a.id, title: 'Ошибка', text: '', status: 'error', error: a.message })
    }
    case 'prev': {
      if (s.entries.length === 0) return s
      const current = Math.max(0, s.current - 1)
      return { ...s, current, following: current === s.entries.length - 1 }
    }
    case 'next': {
      if (s.entries.length === 0) return s
      const current = Math.min(s.entries.length - 1, s.current + 1)
      return { ...s, current, following: current === s.entries.length - 1 }
    }
    case 'clear':
      return { entries: [], current: 0, following: true }
    default:
      return s
  }
}

const initialHistory: HistoryState = { entries: [], current: 0, following: true }

export function OverlayApp(): JSX.Element {
  const [history, dispatch] = useReducer(historyReducer, initialHistory)
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([])
  const [listening, setListening] = useState(false)
  const [interactive, setInteractive] = useState(true)
  const [input, setInput] = useState('')
  const [kbEnabled, setKbEnabled] = useState(false)
  const [kbCount, setKbCount] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pipeline = useRef<AudioPipeline | null>(null)

  const cur = history.entries[history.current] as AnswerEntry | undefined
  const busy = cur?.status === 'streaming'
  const total = history.entries.length

  // Автоскролл вниз при стриминге текущего ответа.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [cur?.text, history.current])

  const handleStream = useCallback((e: StreamEvent) => {
    if (e.type === 'start') dispatch({ t: 'start', id: e.requestId, title: e.title ?? 'Вопрос' })
    else if (e.type === 'delta') dispatch({ t: 'delta', id: e.requestId, text: e.text })
    else if (e.type === 'done') dispatch({ t: 'done', id: e.requestId })
    else if (e.type === 'error') dispatch({ t: 'error', id: e.requestId, message: e.message })
  }, [])

  const startListening = useCallback(async () => {
    if (!pipeline.current) pipeline.current = new AudioPipeline()
    if (pipeline.current.isRunning()) return
    const settings = await window.api.getSettings()
    await pipeline.current.start(
      { mic: settings.stt.captureMicrophone, system: settings.stt.captureSystemAudio },
      {
        onSegment: (source: AudioSource, wav) => window.api.sendAudioSegment({ source, wav }),
        onError: (msg) => dispatch({ t: 'error', id: 'audio', message: msg })
      }
    )
    const running = pipeline.current.isRunning()
    setListening(running)
    window.api.setListeningState(running)
  }, [])

  const stopListening = useCallback(() => {
    pipeline.current?.stop()
    setListening(false)
    window.api.setListeningState(false)
  }, [])

  const toggleListening = useCallback(() => {
    if (pipeline.current?.isRunning()) stopListening()
    else void startListening()
  }, [startListening, stopListening])

  // Подписки на IPC.
  useEffect(() => {
    const offStream = window.api.onStream(handleStream)
    const offTranscript = window.api.onTranscript((seg) =>
      setTranscript((prev) => [...prev.slice(-40), seg])
    )
    const offClick = window.api.onSetClickThrough((enabled) => setInteractive(!enabled))
    void window.api.getSettings().then((s) => setKbEnabled(s.knowledgeBase.enabled))
    void window.api.kbList().then((d) => setKbCount(d.length))
    const offKb = window.api.onKbChanged((d) => setKbCount(d.length))
    const offSettings = window.api.onSettingsChanged((s) => setKbEnabled(s.knowledgeBase.enabled))
    const offCmd = window.api.onCommand((cmd) => {
      if (cmd === 'toggle-listening') toggleListening()
      else if (cmd === 'clear') {
        dispatch({ t: 'clear' })
        setTranscript([])
      } else if (cmd === 'prev-answer') dispatch({ t: 'prev' })
      else if (cmd === 'next-answer') dispatch({ t: 'next' })
      else if (cmd === 'scroll-up') scrollRef.current?.scrollBy({ top: -200, behavior: 'smooth' })
      else if (cmd === 'scroll-down') scrollRef.current?.scrollBy({ top: 200, behavior: 'smooth' })
    })
    return () => {
      offStream()
      offTranscript()
      offClick()
      offKb()
      offSettings()
      offCmd()
    }
  }, [handleStream, toggleListening])

  const toggleKb = async (): Promise<void> => {
    const s = await window.api.getSettings()
    const next = !s.knowledgeBase.enabled
    setKbEnabled(next)
    await window.api.updateSettings({ knowledgeBase: { ...s.knowledgeBase, enabled: next } })
  }

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await window.api.ask({ prompt: text })
  }, [input])

  const setInteractiveMode = (on: boolean): void => {
    setInteractive(on)
    window.api.setClickThrough(!on)
  }

  const captureScreen = async (): Promise<void> => {
    try {
      const dataUrl = await window.api.captureScreen()
      await window.api.ask({ images: [{ dataUrl }] })
    } catch (e) {
      dispatch({ t: 'error', id: 'capture', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // Ресайз окна за угловой грип (надёжно работает и на прозрачном окне).
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.screenX
    const startY = e.screenY
    const startW = window.innerWidth
    const startH = window.innerHeight
    const onMove = (ev: MouseEvent): void => {
      window.api.resizeOverlay(startW + (ev.screenX - startX), startH + (ev.screenY - startY))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const questions = transcript.filter((s) => s.isQuestion).length

  return (
    <div className="overlay">
      <div className="overlay-card">
        <div className="overlay-header">
          <span className={`dot ${busy ? 'busy' : listening ? 'live' : ''}`} />
          <span className="title">
            Quiet Helper{listening ? ` · слушаю (${questions} воп.)` : ''}
          </span>
          <button
            className="icon-btn"
            title={interactive ? 'Сделать сквозным (не перехватывать мышь)' : 'Сделать активным'}
            onClick={() => setInteractiveMode(!interactive)}
          >
            {interactive ? '👆' : '✋'}
          </button>
          <button
            className="icon-btn"
            title={listening ? 'Остановить слушание' : 'Слушать разговор'}
            onClick={toggleListening}
          >
            {listening ? '⏹' : '🎧'}
          </button>
          {kbCount > 0 && (
            <button
              className="icon-btn"
              title={kbEnabled ? `База знаний включена (${kbCount} док.)` : 'База знаний выключена'}
              onClick={() => void toggleKb()}
              style={{ opacity: kbEnabled ? 1 : 0.4 }}
            >
              📚
            </button>
          )}
          <button className="icon-btn" title="Настройки" onClick={() => window.api.openSettings()}>
            ⚙
          </button>
          <button className="icon-btn" title="Скрыть" onClick={() => window.api.hideOverlay()}>
            ✕
          </button>
        </div>

        {total > 0 && (
          <div className="answer-nav">
            <button
              className="icon-btn"
              disabled={history.current <= 0}
              title="Предыдущий ответ (Ctrl+Alt+←)"
              onClick={() => dispatch({ t: 'prev' })}
            >
              ◀
            </button>
            <span className="nav-pos">
              {history.current + 1}/{total}
            </span>
            <span className="nav-title">
              {cur?.status === 'streaming' ? '⏳ ' : ''}
              {cur?.title}
            </span>
            {!history.following && total > 0 && <span className="nav-new">● новее</span>}
            <button
              className="icon-btn"
              disabled={history.current >= total - 1}
              title="Следующий ответ (Ctrl+Alt+→)"
              onClick={() => dispatch({ t: 'next' })}
            >
              ▶
            </button>
          </div>
        )}

        <div className="overlay-body-scroll" ref={scrollRef}>
          {cur?.error && <div className="error-banner">{cur.error}</div>}
          {cur && !cur.error && cur.text && <Markdown text={cur.text} />}
          {cur && !cur.error && !cur.text && cur.status === 'streaming' && (
            <div className="placeholder">Думаю…</div>
          )}
          {total === 0 && (
            <div className="placeholder">
              <p>Готов помочь. Способы задать вопрос:</p>
              <p>
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> — выделить область экрана
                <br />
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> — скриншот всего экрана
                <br />
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — слушать разговор
                <br />
                <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> — листать ответы
                <br />
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> — сделать окно активным для ввода
              </p>
            </div>
          )}
        </div>

        {transcript.length > 0 && (
          <div className="transcript">
            {transcript.slice(-6).map((s) => (
              <div key={s.id} className={`seg ${s.isQuestion ? 'q' : ''}`}>
                <span className="who">{s.source === 'microphone' ? 'Я' : 'Собеседник'}:</span>
                {s.text}
              </div>
            ))}
          </div>
        )}

        <div className="toolbar">
          <button className="btn" onClick={captureScreen}>
            📷 Экран
          </button>
          <button className="btn" onClick={() => window.api.beginRegionSelection()}>
            ◱ Область
          </button>
          <button className="btn" onClick={() => window.api.ask({ includeTranscript: true })}>
            💬 По разговору
          </button>
          {busy && cur && (
            <button className="btn ghost" onClick={() => window.api.cancelAsk(cur.id)}>
              Стоп
            </button>
          )}
        </div>

        <div className="overlay-input">
          <textarea
            value={input}
            placeholder={interactive ? 'Спросить что угодно…' : 'Ctrl+Shift+C, чтобы печатать'}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => window.api.setInteractive(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
          />
          <button className="btn primary" onClick={() => void send()} disabled={!input.trim()}>
            ➤
          </button>
        </div>

        <div className="resize-grip" onMouseDown={startResize} title="Потяните, чтобы изменить размер" />
      </div>
    </div>
  )
}
