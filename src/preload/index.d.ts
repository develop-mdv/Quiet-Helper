import type { QuietHelperApi } from './index'

declare global {
  interface Window {
    api: QuietHelperApi
  }
}

export {}
