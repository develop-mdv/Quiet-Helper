import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'

interface Point {
  x: number
  y: number
}

function SelectionApp(): JSX.Element {
  const [start, setStart] = useState<Point | null>(null)
  const [cur, setCur] = useState<Point | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.selectionCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect =
    start && cur
      ? {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y)
        }
      : null

  const onDown = (e: React.MouseEvent): void => {
    dragging.current = true
    setStart({ x: e.clientX, y: e.clientY })
    setCur({ x: e.clientX, y: e.clientY })
  }
  const onMove = (e: React.MouseEvent): void => {
    if (dragging.current) setCur({ x: e.clientX, y: e.clientY })
  }
  const onUp = (): void => {
    dragging.current = false
    if (rect && rect.width > 3 && rect.height > 3) {
      window.api.selectionDone(rect)
    } else {
      window.api.selectionCancel()
    }
  }

  return (
    <div
      className="selection-root"
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
    >
      <div className="selection-hint">
        Выделите область с вопросом · Esc — отмена
      </div>
      {rect && (
        <div
          className="selection-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <div className="selection-size" style={{ top: -20, left: 0 }}>
            {Math.round(rect.width)}×{Math.round(rect.height)}
          </div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SelectionApp />
  </StrictMode>
)
