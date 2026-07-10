import { desktopCapturer, screen, nativeImage } from 'electron'
import type { Rect } from '@shared/types'

export type { Rect }

/** Захватывает основной экран в полном разрешении, возвращает nativeImage. */
async function grabPrimaryScreen(): Promise<Electron.NativeImage> {
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
  })
  // Ищем источник основного дисплея; фолбэк — первый.
  const primaryId = String(display.id)
  const source =
    sources.find((s) => s.display_id === primaryId) ?? sources[0]
  if (!source) throw new Error('Не удалось получить источник экрана.')
  return source.thumbnail
}

/** Скриншот всего основного экрана как data:image/png;base64. */
export async function captureScreen(): Promise<string> {
  const img = await grabPrimaryScreen()
  return img.toDataURL()
}

/**
 * Скриншот выделенной области. rect задаётся в DIP-координатах (как в рендерере),
 * пересчитываем в пиксели с учётом scaleFactor.
 */
export async function captureRegion(rect: Rect): Promise<string> {
  const img = await grabPrimaryScreen()
  const scale = screen.getPrimaryDisplay().scaleFactor || 1
  const px = {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale)
  }
  if (px.width < 2 || px.height < 2) {
    // Слишком маленькая область — вернём весь экран.
    return img.toDataURL()
  }
  const cropped = img.crop(px)
  return cropped.toDataURL()
}

/** Уменьшает картинку, если она слишком большая, чтобы не раздувать запрос. */
export function downscaleDataUrl(dataUrl: string, maxWidth = 1600): string {
  const img = nativeImage.createFromDataURL(dataUrl)
  const size = img.getSize()
  if (size.width <= maxWidth) return dataUrl
  const resized = img.resize({ width: maxWidth })
  return resized.toDataURL()
}
