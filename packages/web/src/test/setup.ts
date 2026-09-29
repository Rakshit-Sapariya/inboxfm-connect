import { vi } from 'vitest'
import '../lib/i18n'

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true,
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: ResizeObserverStub,
})

Element.prototype.scrollIntoView = () => {}

class RequestStub {
  url: string
  method: string
  headers: Headers

  constructor(input: string | RequestStub, init?: { method?: string; headers?: HeadersInit }) {
    this.url =
      typeof input === 'string' ? new URL(input, window.location.origin).toString() : input.url
    this.method = init?.method ?? 'GET'
    this.headers = new Headers(init?.headers)
  }
}

Object.defineProperty(window, 'Request', {
  configurable: true,
  writable: true,
  value: RequestStub,
})
