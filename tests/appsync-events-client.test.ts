import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AppSyncEventsClient,
  AWS_APPSYNC_EVENTS_SUBPROTOCOL,
  type ProtocolMessage,
} from '../lib/appsync-events-client'
import WS from 'jest-websocket-mock'

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
  afterEach(() => {
    WS.clean()
  })

  it('should construct properly with valid endpoint and options', async () => {
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'my-key',
    })

    expect(client).toBeInstanceOf(AppSyncEventsClient)
  })

  it('should connect successfully with API key auth', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
    })
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
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
    })

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
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
    })

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

  it('Receives data messages after subscribing', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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

  it('does not trigger callbacks after unsubscribe', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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

  it('should publish to a channel', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
    const client = new AppSyncEventsClient('localhost:1234', {
      apiKey: 'api-key',
    })
    // Connect first
    await client.connect()

    // Create a spy on the WebSocket's send method
    const sendSpy = vi.spyOn((client as any).ws, 'send')

    // Publish to a channel
    const testData = { message: 'Hello, world!' }
    await client.publish('test/channel', testData)

    // Verify the send method was called
    expect(sendSpy).toHaveBeenCalled()

    // Verify the message contains the right data and type
    const lastCallData = sendSpy.mock.lastCall?.[0]
    expect(lastCallData).toBeDefined()

    const messageData = JSON.parse(lastCallData as string)
    expect(messageData.type).toBe('publish')
    expect(messageData.channel).toBe('test/channel')
    expect(messageData.events.length).toBe(1)
    expect(JSON.parse(messageData.events[0])).toEqual(testData)
  })

  it('should return a publish only channel', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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
    expect(channel.id).toBe('<not-subscribed>')

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
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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

  it('should disconnect correctly', async () => {
    server = new WS('wss://localhost:1234/event/realtime', {
      selectProtocol,
      jsonProtocol: true,
    })
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
})
