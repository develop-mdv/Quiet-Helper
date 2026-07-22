const MAX_CONCURRENT_API_REQUESTS = 1
const DEFAULT_MAX_ATTEMPTS = 6
const MAX_BACKOFF_DELAY_MS = 30_000
const MAX_SERVER_RETRY_DELAY_MS = 5 * 60_000

interface QueuedRequest {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  cancelled: boolean
  onAbort?: () => void
}

function abortError(): Error {
  const error = new Error('Запрос отменён.')
  error.name = 'AbortError'
  return error
}

/**
 * Chat, cloud STT and embeddings use the same key, so they must share one
 * process-wide in-flight limit.
 */
class ApiRequestLimiter {
  private active = 0
  private queue: QueuedRequest[] = []
  private blockedUntil = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  pauseFor(delayMs: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delayMs)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError())

    return new Promise((resolve, reject) => {
      const request: QueuedRequest = { resolve, reject, signal, cancelled: false }
      if (signal) {
        request.onAbort = (): void => {
          if (request.cancelled) return
          request.cancelled = true
          reject(abortError())
          this.drain()
        }
        signal.addEventListener('abort', request.onAbort, { once: true })
      }
      this.queue.push(request)
      this.drain()
    })
  }

  private drain(): void {
    if (this.active >= MAX_CONCURRENT_API_REQUESTS) return

    const waitMs = this.blockedUntil - Date.now()
    if (waitMs > 0) {
      if (!this.wakeTimer) {
        this.wakeTimer = setTimeout(() => {
          this.wakeTimer = null
          this.drain()
        }, waitMs)
      }
      return
    }

    let request = this.queue.shift()
    while (request?.cancelled || request?.signal?.aborted) {
      if (!request.cancelled) request.reject(abortError())
      if (request.signal && request.onAbort) {
        request.signal.removeEventListener('abort', request.onAbort)
      }
      request = this.queue.shift()
    }
    if (!request) return

    request.cancelled = true
    if (request.signal && request.onAbort) {
      request.signal.removeEventListener('abort', request.onAbort)
    }
    this.active++
    let released = false
    request.resolve(() => {
      if (released) return
      released = true
      this.active--
      this.drain()
    })
  }
}

const apiLimiter = new ApiRequestLimiter()

export interface ApiRequestOptions {
  signal?: AbortSignal
  maxAttempts?: number
  /** Streaming callers use this to avoid replaying an answer after data was emitted. */
  retryIf?: (error: unknown) => boolean
}

export async function runApiRequest<T>(
  operation: (attempt: number) => Promise<T>,
  options: ApiRequestOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw abortError()
    let scheduledDelayMs: number | undefined
    try {
      return await apiLimiter.run(async () => {
        try {
          return await operation(attempt)
        } catch (error) {
          const canRetry = isRetryableApiError(error) && (options.retryIf?.(error) ?? true)
          if (canRetry && attempt + 1 < maxAttempts) {
            scheduledDelayMs = retryDelayMs(error, attempt)
            // This happens before the slot is released, so the next queued
            // request cannot slip through during the provider cooldown.
            apiLimiter.pauseFor(scheduledDelayMs)
          }
          throw error
        }
      }, options.signal)
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error
      const canRetry = isRetryableApiError(error) && (options.retryIf?.(error) ?? true)
      if (!canRetry || attempt + 1 >= maxAttempts) throw error

      const delayMs = scheduledDelayMs ?? retryDelayMs(error, attempt)
      await abortableDelay(delayMs, options.signal)
    }
  }
}

export class ApiHttpError extends Error {
  readonly status: number
  readonly retryAfterMs?: number

  constructor(context: string, status: number, detail: string, retryAfterMs?: number) {
    const suffix = detail.trim() ? ` ${detail.trim().slice(0, 500)}` : ''
    const message =
      status === 429
        ? `${context}: API временно занят (HTTP 429). Автоматические повторы не помогли; повторите чуть позже.`
        : `${context}: HTTP ${status}.${suffix}`
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export async function apiErrorFromResponse(response: Response, context: string): Promise<ApiHttpError> {
  const body = await response.text().catch(() => '')
  const detail = apiErrorDetail(body)
  return new ApiHttpError(context, response.status, detail, retryAfterFromHeaders(response.headers))
}

export function apiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as { status?: unknown }).status
  if (typeof value === 'number') return value
  const responseStatus = (error as { response?: { status?: unknown } }).response?.status
  return typeof responseStatus === 'number' ? responseStatus : undefined
}

function isRetryableApiError(error: unknown): boolean {
  const status = apiErrorStatus(error)
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
  }
  if (!(error instanceof Error)) return false
  if (error instanceof TypeError) return true
  return /APIConnection|Timeout|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND/i.test(
    `${error.name} ${error.message}`
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function retryDelayMs(error: unknown, attempt: number): number {
  const serverDelay = retryAfterFromError(error)
  if (serverDelay !== undefined) {
    return Math.min(MAX_SERVER_RETRY_DELAY_MS, Math.max(0, serverDelay))
  }

  const base = Math.min(MAX_BACKOFF_DELAY_MS, 750 * 2 ** attempt)
  return Math.round(base * (1 + Math.random() * 0.25))
}

function retryAfterFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const direct = (error as { retryAfterMs?: unknown }).retryAfterMs
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  return retryAfterFromUnknownHeaders((error as { headers?: unknown }).headers)
}

function retryAfterFromUnknownHeaders(headers: unknown): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  if ('get' in headers && typeof (headers as Headers).get === 'function') {
    return retryAfterFromHeaders(headers as Headers)
  }
  const record = headers as Record<string, unknown>
  const retryAfterMs = record['retry-after-ms'] ?? record['Retry-After-Ms']
  if (typeof retryAfterMs === 'string') {
    const parsed = Number(retryAfterMs)
    if (Number.isFinite(parsed)) return parsed
  }
  const retryAfter = record['retry-after'] ?? record['Retry-After']
  const rateLimitReset =
    record['x-rate-limit-reset'] ??
    record['x-ratelimit-reset'] ??
    record['X-Rate-Limit-Reset'] ??
    record['x-rate-limit-reset-requests'] ??
    record['x-ratelimit-reset-requests'] ??
    record['X-RateLimit-Reset-Requests'] ??
    record['X-Rate-Limit-Reset-Requests']
  return maximumDelay(
    typeof retryAfter === 'string' ? parseRetryAfter(retryAfter) : undefined,
    typeof rateLimitReset === 'string' ? parseRateLimitReset(rateLimitReset) : undefined
  )
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const milliseconds = headers.get('retry-after-ms')
  let retryAfterMs: number | undefined
  if (milliseconds) {
    const parsed = Number(milliseconds)
    if (Number.isFinite(parsed)) retryAfterMs = parsed
  }
  const retryAfter = headers.get('retry-after')
  const resetValues = [
    headers.get('x-rate-limit-reset'),
    headers.get('x-rate-limit-reset-requests'),
    headers.get('x-rate-limit-reset-tokens'),
    headers.get('x-ratelimit-reset'),
    headers.get('x-ratelimit-reset-requests'),
    headers.get('x-ratelimit-reset-tokens')
  ]
    .filter((value): value is string => Boolean(value))
    .map(parseRateLimitReset)

  return maximumDelay(
    retryAfterMs,
    retryAfter ? parseRetryAfter(retryAfter) : undefined,
    ...resetValues
  )
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** AllTokens documents X-Rate-Limit-Reset but does not fix one value format. */
function parseRateLimitReset(value: string): number | undefined {
  const normalized = value.trim().toLowerCase()
  const duration = normalized.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/)
  if (duration) {
    const amount = Number(duration[1])
    const unit = duration[2] as 'ms' | 's' | 'm' | 'h'
    const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]
    return amount * multiplier
  }

  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) return Math.max(0, numeric - Date.now())
    if (numeric > 1_000_000_000) return Math.max(0, numeric * 1000 - Date.now())
    return Math.max(0, numeric * 1000)
  }

  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function maximumDelay(...values: (number | undefined)[]): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value))
  return finite.length > 0 ? Math.max(...finite) : undefined
}

function apiErrorDetail(body: string): string {
  if (!body.trim()) return ''
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: unknown }
      message?: unknown
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // Some upstream providers return plain text or HTML errors.
  }
  return body
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
