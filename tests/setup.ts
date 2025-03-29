import { afterEach, vi } from 'vitest'

// Define a mock WebSocket class since jsdom doesn't implement it
class MockWebSocket implements WebSocket {
  readonly CONNECTING: 0
  readonly OPEN: 1
  readonly CLOSING: 2
  readonly CLOSED: 3

  static readonly CONNECTING = WebSocket.CONNECTING
  static readonly OPEN = WebSocket.OPEN
  static readonly CLOSING = WebSocket.CLOSING
  static readonly CLOSED = WebSocket.CLOSED

  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  readyState: number = MockWebSocket.CLOSED
  url = ''

  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null
  onerror: ((this: WebSocket, ev: Event) => any) | null = null
  onmessage: ((this: WebSocket, ev: MessageEvent<any>) => any) | null = null
  onopen: ((this: WebSocket, ev: Event) => any) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    if (typeof protocols === 'string') {
      this.protocol = protocols
    } else if (Array.isArray(protocols) && protocols.length > 0) {
      this.protocol = protocols[0]
    }

    // Auto-connect after constructor
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) {
        this.onopen(new Event('open'))
      }
    }, 0)
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }))
    }
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // Default implementation that does nothing
  }

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    // Not implemented for tests
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void {
    // Not implemented for tests
  }

  dispatchEvent(event: Event): boolean {
    return true
  }
}

// Set up global mocks
// global.WebSocket = MockWebSocket

// Mock crypto.randomUUID if not available
if (!crypto.randomUUID) {
  crypto.randomUUID = vi.fn((): `${string}-${string}-${string}-${string}-${string}` => 'a-b-c-d-e')
}

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks()
})

