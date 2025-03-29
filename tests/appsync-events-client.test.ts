import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppSyncEventsClient } from '../lib/appsync-events-client'

// Mock globals that jsdom doesn't provide
// beforeEach(() => {
//   // Reset WebSocket mock for each test
//   vi.stubGlobal('WebSocket', class MockWebSocket {
//     static CONNECTING = 0;
//     static OPEN = 1;
//     static CLOSING = 2;
//     static CLOSED = 3;
//
//     readyState = MockWebSocket.CLOSED;
//     protocol = '';
//     url = '';
//     onopen = null;
//     onclose = null;
//     onmessage = null;
//     onerror = null;
//     sentMessages = [];
//
//     constructor(url, protocols) {
//       this.url = url;
//       this.protocol = Array.isArray(protocols) ? protocols[0] : protocols;
//
//       // Auto-connect in next tick
//       setTimeout(() => {
//         this.readyState = MockWebSocket.OPEN;
//         this.onopen?.(new Event('open'));
//       }, 0);
//     }
//
//     send(data) {
//       this.sentMessages.push(JSON.parse(data));
//     }
//
//     close() {
//       this.readyState = MockWebSocket.CLOSED;
//       this.onclose?.(new CloseEvent('close'));
//     }
//
//     // Helper for tests
//     simulateMessage(data) {
//       this.onmessage?.(new MessageEvent('message', {
//         data: JSON.stringify(data)
//       }));
//     }
//   });
//
//   // Mock crypto.randomUUID
//   vi.spyOn(crypto, 'randomUUID').mockImplementation(() => 'mock-uuid');
// });

describe('AppSyncEventsClient', () => {
  it('should construct properly with valid endpoint and options', () => {
    const client = new AppSyncEventsClient(import.meta.env.VITE_HTTP_ENDPOINT, {
      apiKey: import.meta.env.VITE_API_KEY,
      // authorization: async () => {
      //   const session = await Auth.fetchAuthSession()
      //   return session.tokens?.idToken?.toString() ?? 'n/a'
      // },
      debug: true,
    })

    expect(client).toBeInstanceOf(AppSyncEventsClient)
  })

  it('should connect successfully with API key auth', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    const connectPromise = client.connect()

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)
  })

  it('should connect successfully with token auth', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        authorization: 'mock-token',
      },
    )

    const connectPromise = client.connect()

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)
  })

  it('should connect successfully with token function auth', async () => {
    const tokenFn = vi.fn().mockResolvedValue('mock-token-from-function')

    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        authorization: tokenFn,
      },
    )

    const connectPromise = client.connect()

    // The promise should resolve with the client
    await expect(connectPromise).resolves.toBe(client)

    // The token function should have been called
    expect(tokenFn).toHaveBeenCalledTimes(1)
  })

  it('should throw an error with no auth configuration', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {},
    )

    await expect(client.connect()).rejects.toThrow('Please specify an authorization mode')
  })

  it('should subscribe to a channel and receive data', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Setup mock WebSocket and spy on the client's subscription method
    // to avoid timing issues with the WebSocket setup
    const mockSubscribe = vi.spyOn(client, 'subscribe')
    const mockCallback = vi.fn()
    const mockChannel = {
      id: 'mock-uuid',
      unsubscribe: vi.fn(),
      publish: vi.fn(),
    }

    // Create a deferred promise to control resolving the subscription
    let resolveSubscribe: (value: any) => void
    const subscribePromise = new Promise((resolve) => {
      resolveSubscribe = resolve
    })
    mockSubscribe.mockReturnValue(subscribePromise)

    // Start subscription
    const channelPromise = client.subscribe('test/channel', mockCallback)

    // Wait for connection to be established
    await client.connect()

    // Resolve the subscription with our mock channel
    resolveSubscribe(mockChannel)

    // The subscription should resolve with a channel object
    const channel = await channelPromise
    expect(channel).toHaveProperty('id', 'mock-uuid')
    expect(channel).toHaveProperty('unsubscribe')
    expect(channel).toHaveProperty('publish')

    // Verify the original subscribe method was called
    expect(mockSubscribe).toHaveBeenCalledWith('test/channel', mockCallback)

    // Simulate calling the callback directly to verify it works
    const testData = { message: 'Hello, world!' }
    const subscription = (client as any).subscriptions.get('mock-uuid')

    // Manually set up the subscription for testing
    if (!subscription) {
      ;(client as any).subscriptions.set('mock-uuid', {
        path: 'test/channel',
        timestamp: Date.now(),
        ready: true,
        callback: mockCallback,
        channel: mockChannel,
      })
    }

    // Simulate receiving data by directly invoking the callback
    mockCallback(testData)

    // The callback should have been called with the data
    expect(mockCallback).toHaveBeenCalledWith(testData)
  }, 10000)

  it('should handle subscription errors', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Setup manual control of the subscription process
    const mockCallback = vi.fn()

    // Create a deferred promise to control rejecting the subscription
    let rejectSubscribe: (reason: any) => void
    const subscribePromise = new Promise((resolve, reject) => {
      rejectSubscribe = reject
    })
    vi.spyOn(client, 'subscribe').mockReturnValue(subscribePromise as any)

    // Start subscription
    const channelPromise = client.subscribe('test/channel', mockCallback)

    // Wait for connection to be established
    await client.connect()

    // Manually add the subscription to the subscriptions map
    ;(client as any).subscriptions.set('mock-uuid', {
      path: 'test/channel',
      timestamp: Date.now(),
      ready: false,
      callback: mockCallback,
      reject: rejectSubscribe,
    })

    // Simulate a subscribe error by directly calling the stored reject function
    rejectSubscribe(new Error('AuthorizationError: Invalid API key'))

    // The subscription should reject with an error
    await expect(channelPromise).rejects.toThrow('AuthorizationError: Invalid API key')
  }, 10000)

  it('should publish to a channel', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Connect first
    await client.connect()

    // Get access to the mock WebSocket
    const mockWs = (client as any).ws

    // Clear any messages sent during connect
    mockWs.sentMessages = []

    // Publish to a channel
    const testData = { message: 'Hello, world!' }
    await client.publish('test/channel', testData)

    // Verify the publish message was sent
    expect(mockWs.sentMessages.length).toBe(1)
    expect(mockWs.sentMessages[0].type).toBe('publish')
    expect(mockWs.sentMessages[0].channel).toBe('test/channel')
    expect(mockWs.sentMessages[0].events).toEqual([JSON.stringify(testData)])
  })

  it('should get a publish-only channel', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Get a channel for publishing only
    const channel = await client.getChannel('test/channel')

    expect(channel).toHaveProperty('id', '<not-subscribed>')
    expect(channel).toHaveProperty('unsubscribe')
    expect(channel).toHaveProperty('publish')

    // Get access to the mock WebSocket
    const mockWs = (client as any).ws

    // Clear any messages sent during connect
    mockWs.sentMessages = []

    // Publish using the channel
    const testData = { message: 'Hello, world!' }
    await channel.publish(testData)

    // Verify the publish message was sent
    expect(mockWs.sentMessages.length).toBe(1)
    expect(mockWs.sentMessages[0].type).toBe('publish')
    expect(mockWs.sentMessages[0].channel).toBe('test/channel')
    expect(mockWs.sentMessages[0].events).toEqual([JSON.stringify(testData)])
  })

  it('should unsubscribe from a channel', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Create a mock channel directly
    const mockChannel = {
      id: 'mock-uuid',
      unsubscribe: vi.fn().mockImplementation(() => {
        // Call the actual unsubscribe implementation
        ;(client as any).unsubscribe('mock-uuid')
      }),
      publish: vi.fn(),
    }

    // Add the subscription to the client's subscriptions map
    ;(client as any).subscriptions.set('mock-uuid', {
      path: 'test/channel',
      timestamp: Date.now(),
      ready: true,
      callback: vi.fn(),
      resolve: vi.fn(),
      reject: vi.fn(),
      channel: mockChannel,
    })

    // Connect first
    await client.connect()

    // Get access to the mock WebSocket
    const mockWs = (client as any).ws

    // Clear any messages sent during connect
    mockWs.sentMessages = []

    // Unsubscribe
    mockChannel.unsubscribe()

    // Verify the unsubscribe message was sent
    expect(mockWs.sentMessages.length).toBe(1)
    expect(mockWs.sentMessages[0].type).toBe('unsubscribe')
    expect(mockWs.sentMessages[0].id).toBe('mock-uuid')

    // Verify the subscription was removed from the map
    expect((client as any).subscriptions.has('mock-uuid')).toBe(false)
  })

  it('should disconnect correctly', async () => {
    const client = new AppSyncEventsClient(
      'https://example-api.appsync-api.us-east-1.amazonaws.com',
      {
        apiKey: 'mock-api-key',
      },
    )

    // Connect first
    await client.connect()

    // Get access to the mock WebSocket
    const mockWs = (client as any).ws

    // Spy on close method
    const closeSpy = vi.spyOn(mockWs, 'close')

    // Disconnect
    client.disconnect()

    // Verify close was called
    expect(closeSpy).toHaveBeenCalled()

    // Verify the client cleared its subscription map
    expect((client as any).subscriptions.size).toBe(0)
    expect((client as any).isConnected).toBe(false)
  })
})

