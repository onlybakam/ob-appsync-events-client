import WS from 'jest-websocket-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AWS_APPSYNC_EVENTS_SUBPROTOCOL,
  AppSyncEventsClient,
  type ProtocolMessage,
} from '../lib/appsync-events-client'

function fromAuthProtocol(auth: string) {
  return JSON.parse(
    atob(
      auth
        .replace(/^header-/, '')
        .replace(/_/g, '/') // reverse: Convert '/' to '_'
        .replace(/-/g, '+'), // reverse: Convert '+' to '-'
    ),
  )
}
function selectProtocol(ps: string[]) {
  const find1 = ps.includes(AWS_APPSYNC_EVENTS_SUBPROTOCOL)
  const find2 = ps.find((val) => val.startsWith('header-'))
  return find1 && find2 ? find2 : null
}

// Mock crypto.randomUUID for consistent test results
vi.spyOn(crypto, 'randomUUID').mockImplementation(() => 'a-b-c-d-e')

let server: WS
describe('AppSyncEventsClient', () => {
  beforeEach(() => {
    // Silence console.error for tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
  })

  afterEach(() => {
    WS.clean()
    vi.restoreAllMocks()
  })

  it('should construct properly with valid endpoint and options', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'my-key',
    })

    expect(client).toBeInstanceOf(AppSyncEventsClient)
  })

  it('should connect successfully with API key auth', async () => {
    server.on('connection', (socket) => {
      const protocol = socket.protocol
      expect(protocol).toMatch(/^header/)
      const auth = fromAuthProtocol(protocol)
      expect(auth).toHaveProperty('host')
      expect(auth.host).toEqual('localhost')
      expect(auth['x-api-key']).toEqual('api-key')
    })
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    const connectPromise = client.connect()

    await server.connected

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)
  })

  it('should connect successfully with token auth', async () => {
    server.on('connection', (socket) => {
      const protocol = socket.protocol
      expect(protocol).toMatch(/^header/)
      const auth = fromAuthProtocol(protocol)
      expect(auth).toHaveProperty('host')
      expect(auth.host).toEqual('localhost')
      expect(auth.authorization).toEqual('my-jwt')
    })
    const client = new AppSyncEventsClient('localhost:1234', {
      authorization: 'my-jwt',
    })
    const connectPromise = client.connect()

    await server.connected

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)
  })

  it('should connect successfully with token auth function', async () => {
    server.on('connection', (socket) => {
      const protocol = socket.protocol
      expect(protocol).toMatch(/^header/)
      const auth = fromAuthProtocol(protocol)
      expect(auth).toHaveProperty('host')
      expect(auth.host).toEqual('localhost')
      expect(auth.authorization).toEqual('async-jwt')
    })
    const client = new AppSyncEventsClient('localhost:1234', {
      authorization: async () => 'async-jwt',
    })
    const connectPromise = client.connect()

    await server.connected

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)
  })

  it('should throw an error when no authentication is provided', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {})
    await expect(client.connect()).rejects.toThrow('Please specify an authorization mode')
  })

  it('should use caching for connection requests', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Spy on the connect method to ensure it only creates one Promise
    const connectSpy = vi.spyOn(client as any, 'getAuthHeaders')

    // First connection
    await client.connect()

    // Second connection should reuse the existing connection
    await client.connect()

    // getAuthHeaders should only be called once for the initial connection
    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  it('should correctly transform AWS event domain URLs', async () => {
    // Setup a client with an AWS domain and check the realtime URL
    const client = new AppSyncEventsClient(
      'abcdefghijklmnopqrstuvwxyz.appsync-api.us-east-1.amazonaws.com',
      { apiKey: 'test-key' },
    )

    // Access private realTimeUrl getter
    const realTimeUrl = (client as any).realTimeUrl

    // Verify transformation
    expect(realTimeUrl).toBe(
      'wss://abcdefghijklmnopqrstuvwxyz.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime',
    )
  })

  it('should correctly transform AWS DDPG domain URLs', async () => {
    // Setup a client with a DDPG domain and check the realtime URL
    const client = new AppSyncEventsClient(
      'abcdefghijklmnopqrstuvwxyz.ddpg-api.us-east-1.amazonaws.com',
      { apiKey: 'test-key' },
    )

    // Access private realTimeUrl getter
    const realTimeUrl = (client as any).realTimeUrl

    // Verify transformation
    expect(realTimeUrl).toContain('grt-gamma')
    expect(realTimeUrl).toContain('wss://')
    expect(realTimeUrl).toContain('/event/realtime')
  })

  it('Receives data messages after subscribing', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    client.connect()
    await server.connected

    const cb = vi.fn()

    const sub = client.subscribe('/default', cb)
    const msg = (await server.nextMessage) as ProtocolMessage.SubscribeMessage
    server.send({
      id: msg.id,
      type: 'subscribe_success',
    } as ProtocolMessage.SubscribeSuccessMessage)

    await expect(sub).resolves.toHaveProperty('id', msg.id)

    const data = { msg: 'hello world!' }
    server.send({
      id: msg.id,
      type: 'data',
      event: JSON.stringify(data),
    } as ProtocolMessage.DataMessage)

    expect(cb).toHaveBeenCalledWith(data)
  })

  it('Can connect during subscribe action', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    const cb = vi.fn()

    const sub = client.subscribe('/default', cb)
    const msg = (await server.nextMessage) as ProtocolMessage.SubscribeMessage
    server.send({
      id: msg.id,
      type: 'subscribe_success',
    } as ProtocolMessage.SubscribeSuccessMessage)

    await expect(sub).resolves.toHaveProperty('id', msg.id)
  })

  it('should handle subscription errors', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    client.connect()
    await server.connected

    const sub = client.subscribe('/default', () => {}, 'waiting-for-id')
    await server.nextMessage
    server.send({
      id: 'waiting-for-id',
      type: 'subscribe_error',
      errors: [{ errorType: 'Faked', message: 'message' }],
    } as ProtocolMessage.SubscribeErrorMessage)

    await expect(sub).rejects.toBeDefined()
  })

  it('should handle subscription errors with no error details', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    client.connect()
    await server.connected

    const sub = client.subscribe('/default', () => {}, 'waiting-for-id')
    await server.nextMessage
    server.send({
      id: 'waiting-for-id',
      type: 'subscribe_error',
      // No errors array provided
    } as ProtocolMessage.SubscribeErrorMessage)

    await expect(sub).rejects.toThrow('Unknown error')
  })

  it('should handle general protocol errors', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
      debug: true, // Enable debug for this test
    })

    const debugSpy = vi.spyOn(console, 'log')

    await client.connect()

    server.send({
      type: 'error',
      errors: [{ errorType: 'ServiceError', message: 'Internal server error' }],
    } as ProtocolMessage.ErrorMessage)

    // Verify debug was called with error info
    expect(debugSpy).toHaveBeenCalledWith(
      'AppSyncEventsClient:',
      'Unexpected error',
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should handle WebSocket connection errors', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Mock the WebSocket to trigger an error
    const mockWebSocket = {
      close: vi.fn(),
      send: vi.fn(),
      addEventListener: vi.fn(),
      readyState: WebSocket.CONNECTING,
    }

    // Force WebSocket to error
    vi.spyOn(global, 'WebSocket').mockImplementationOnce(() => {
      setTimeout(() => {
        // @ts-ignore: Mock event
        mockWebSocket.onerror(new Event('error'))
      }, 0)
      return mockWebSocket as any
    })

    // This should now reject because of the error
    await expect(client.connect()).rejects.toBeDefined()
  })

  it('should handle WebSocket disconnection and attempt reconnect', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
      debug: true,
    })

    // Create a spy on setTimeout for reconnection
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    await client.connect()

    // Now close the connection to trigger reconnection
    server.close()

    expect((client as any).reconnectAttempts).toBe(1)
    // Verify setTimeout was called for reconnection
    expect(setTimeoutSpy).toHaveBeenCalled()
  })

  it('should handle message parsing errors', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    const errorSpy = vi.spyOn(console, 'error')

    await client.connect()

    // Send an invalid JSON message to trigger parsing error
    // @ts-ignore: direct access to private property for testing
    client.ws.onmessage({ data: '{invalid json' })

    expect(errorSpy).toHaveBeenCalledWith('Unexpected message:', expect.any(Error))
  })

  it('does not trigger callbacks after unsubscribe', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    client.connect()
    await server.connected

    const cb = vi.fn()

    const sub = client.subscribe('/default', cb)
    const msg = (await server.nextMessage) as ProtocolMessage.SubscribeMessage
    server.send({
      id: msg.id,
      type: 'subscribe_success',
    } as ProtocolMessage.SubscribeSuccessMessage)

    await expect(sub).resolves.toHaveProperty('id', msg.id)
    const channel = await sub

    channel.unsubscribe()

    const umsg = (await server.nextMessage) as ProtocolMessage.UnsubscribeMessage
    expect(umsg).toHaveProperty('id', msg.id)
    expect(umsg).toHaveProperty('type', 'unsubscribe')

    const data = { msg: 'hello world!' }
    server.send({
      id: msg.id,
      type: 'data',
      event: JSON.stringify(data),
    } as ProtocolMessage.DataMessage)

    expect(cb).not.toBeCalled()
  })

  it('should handle data events for unknown subscriptions', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    await client.connect()

    const errorSpy = vi.spyOn(console, 'error')

    // Send data for non-existent subscription
    server.send({
      id: 'unknown-subscription-id',
      type: 'data',
      event: JSON.stringify({ test: 'data' }),
    } as ProtocolMessage.DataMessage)

    expect(errorSpy).toHaveBeenCalledWith('Subscription not ready: unknown-subscription-id')
  })

  it('should publish to a channel', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    // Connect first
    await client.connect()

    // Publish to a channel
    const testData = { message: 'Hello, world!' }
    await client.publish('test/channel', testData)

    const messageData = (await server.nextMessage) as ProtocolMessage.PublishMessage

    expect(messageData.type).toBe('publish')
    expect(messageData.channel).toBe('test/channel')
    expect(messageData.events.length).toBe(1)
    expect(JSON.parse(messageData.events[0])).toEqual(testData)
  })

  it('should publish multiple events in a single call', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    await client.connect()

    const event1 = { type: 'create', id: '123' }
    const event2 = { type: 'update', id: '456' }
    const event3 = { type: 'delete', id: '789' }

    await client.publish('test/channel', event1, event2, event3)

    const msg = (await server.nextMessage) as ProtocolMessage.PublishMessage

    expect(msg.events.length).toBe(3)
    expect(JSON.parse(msg.events[0])).toEqual(event1)
    expect(JSON.parse(msg.events[1])).toEqual(event2)
    expect(JSON.parse(msg.events[2])).toEqual(event3)
  })

  it('should throw error when publishing to wildcard channel', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    await client.connect()

    await expect(client.publish('/test/*', { data: 'test' })).rejects.toThrow(
      "Cannot publish to channel with '*' in path: /test/*",
    )
  })

  it('should throw error when publishing with no events', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    await client.connect()

    // @ts-ignore: intentionally passing no events for testing
    await expect(client.publish('/test')).rejects.toThrow(
      'You can publish up to 5 events at a time',
    )
  })

  it('should throw error when publishing with too many events', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    await client.connect()

    await expect(client.publish('/test', 1, 2, 3, 4, 5, 6)).rejects.toThrow(
      'You can publish up to 5 events at a time',
    )
  })

  it('should throw error when publishing without a connection', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    await expect(client.publish('/test', { data: 'test' })).rejects.toThrow(
      'WebSocket is not connected',
    )
  })

  it('should throw error when trying to subscribe without a connection', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Mock connect to fail
    vi.spyOn(client, 'connect').mockRejectedValue(new Error('Connection failed'))

    await expect(client.subscribe('/test', () => {})).rejects.toThrow('Connection failed')
  })

  it('should throw error when subscribing to a channel with WebSocket not ready', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Mock connect to succeed but set WebSocket to null
    vi.spyOn(client, 'connect').mockResolvedValue(client)

    // @ts-ignore - Setting private property for test
    client.ws = null

    await expect(client.subscribe('/test', () => {})).rejects.toThrow('WebSocket not ready')
  })

  it('should return a publish only channel', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    // Connect first
    await client.connect()

    // Create a spy on the WebSocket's send method
    const sendSpy = vi.spyOn((client as any).ws, 'send')

    // Publish to a channel
    const testData = { message: 'Hello, world!' }
    const channel = await client.getChannel('test/channel')

    expect(channel).toBeDefined()
    expect(channel.id).toBe('<not-subscribed-publish-only>')

    channel.publish(testData)

    const msg = (await server.nextMessage) as ProtocolMessage.PublishMessage
    expect(msg.type).toBe('publish')
    expect(msg.channel).toBe('test/channel')
    expect(msg.events.length).toBe(1)
    expect(msg.authorization).toBeDefined()
    expect(msg.authorization['x-api-key']).toBe('api-key')
    expect(JSON.parse(msg.events[0])).toEqual(testData)

    // Verify the send method was called
    expect(sendSpy).toHaveBeenCalled()
  })

  it('should unsubscribe from a channel', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    // Connect first
    await client.connect()

    // Create a spy on the WebSocket's send method
    const sendSpy = vi.spyOn((client as any).ws, 'send')

    // Setup a mock of the subscribe functionality
    const cb = vi.fn()

    const sub = client.subscribe('/default', cb, 'mock-uuid')
    const msg = (await server.nextMessage) as ProtocolMessage.SubscribeMessage
    server.send({
      id: msg.id,
      type: 'subscribe_success',
    } as ProtocolMessage.SubscribeSuccessMessage)

    await expect(sub).resolves.toHaveProperty('id', msg.id)
    expect((client as any).subscriptions.has('mock-uuid')).toBe(true)
    const channel = await sub

    channel.unsubscribe()

    // Verify the send method was called
    expect(sendSpy).toHaveBeenCalled()

    // Verify the subscription was removed from the map
    expect((client as any).subscriptions.has('mock-uuid')).toBe(false)
  })

  it('should throw error when trying to unsubscribe without a connection', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // @ts-ignore - Accessing private method for testing
    expect(() => client.unsubscribe('test-id')).toThrow('WebSocket is not connected')
  })

  it('should provide connection status through properties', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Initial state
    expect(client.connected).toBe(false)
    expect(client.status).toBe(-1)

    // After connection
    await client.connect()
    expect(client.connected).toBe(true)
    expect(client.status).toBe(WebSocket.OPEN)

    // After disconnection
    client.disconnect()
    expect(client.connected).toBe(false)
  })

  it('should disconnect correctly', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    // Connect first
    await client.connect()

    // Ensure we have an active WebSocket
    expect((client as any).ws).toBeDefined()
    const ws = (client as any).ws

    // Spy on close method
    const closeSpy = vi.spyOn(ws, 'close')

    // Disconnect
    client.disconnect()

    // Verify close was called
    expect(closeSpy).toHaveBeenCalled()

    // Verify the client cleared its subscription map
    expect((client as any).subscriptions.size).toBe(0)
    expect((client as any).isConnected).toBe(false)
  })

  it('should handle disconnect when not connected', () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })

    // Should not throw an error
    expect(() => client.disconnect()).not.toThrow()
  })
})
