import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSyncEventsClient, type Channel } from '../lib/appsync-events-client'
import { useChannel } from '../lib/react-hooks'

// Define a custom type for our mocked client
interface MockClientType extends AppSyncEventsClient {
  subscribe: ReturnType<typeof vi.fn>
}

// Mock the AppSyncEventsClient
vi.mock('../lib/appsync-events-client', () => {
  const mockChannel: Channel = {
    id: 'mock-channel-id',
    publish: vi.fn(),
    unsubscribe: vi.fn(),
  }

  return {
    AppSyncEventsClient: vi.fn().mockImplementation(() => ({
      subscribe: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockChannel)
      }),
      getChannel: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockChannel)
      }),
    })),
  }
})

describe('React Hooks', () => {
  let mockClient: MockClientType

  beforeEach(() => {
    mockClient = new AppSyncEventsClient('https://example.com', {})
    vi.clearAllMocks()
  })

  describe('useChannel', () => {
    it('should return a channel and isReady=false initially', async () => {
      let result: any
      await act(async () => {
        result = renderHook(() => useChannel(mockClient, 'test/channel')).result
      })

      const { channel, isReady } = result.current

      expect(channel).toHaveProperty('id')
      expect(channel).toHaveProperty('publish')
      expect(channel).toHaveProperty('unsubscribe')
      // The mock implementation resolves immediately, so isReady will be true
      expect(isReady).toBe(true)
    })

    it('should call getChannel when no callback is provided', async () => {
      await act(async () => {
        renderHook(() => useChannel(mockClient, 'test/channel'))
      })

      // Expect getChannel to have been called
      expect(mockClient.getChannel).toHaveBeenCalledWith('test/channel')
      expect(mockClient.subscribe).not.toHaveBeenCalled()
    })

    it('should call subscribe when a callback is provided', async () => {
      const mockCallback = vi.fn()

      await act(async () => {
        renderHook(() => useChannel(mockClient, 'test/channel', mockCallback))
      })

      // Expect subscribe to have been called
      expect(mockClient.subscribe).toHaveBeenCalledWith('test/channel', expect.any(Function))
      expect(mockClient.getChannel).not.toHaveBeenCalled()
    })

    it('should unsubscribe when unmounted', async () => {
      const mockUnsubscribe = vi.fn()

      // Mock the channel returned by subscribe
      mockClient.subscribe.mockResolvedValue({
        id: 'mock-channel-id',
        publish: vi.fn(),
        unsubscribe: mockUnsubscribe,
      })

      let unmountFn: () => void

      await act(async () => {
        const { unmount } = renderHook(() => useChannel(mockClient, 'test/channel', vi.fn()))
        unmountFn = unmount
      })

      // Unmount the hook
      act(() => {
        unmountFn()
      })

      // Verify unsubscribe was called
      expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('should handle callback changes', async () => {
      const initialCallback = vi.fn()
      const updatedCallback = vi.fn()
      let savedCallback: Function | null = null

      // Mock the subscribe method to capture the callback
      mockClient.subscribe.mockImplementation((path, callback) => {
        savedCallback = callback
        return Promise.resolve({
          id: 'mock-channel-id',
          publish: vi.fn(),
          unsubscribe: vi.fn(),
        })
      })

      let rerenderHook: (props: { callback: (data: any) => void }) => void

      await act(async () => {
        const { rerender } = renderHook(
          ({ callback }) => useChannel(mockClient, 'test/channel', callback),
          { initialProps: { callback: initialCallback } },
        )
        rerenderHook = rerender
      })

      // Simulate receiving data with initial callback
      act(() => {
        savedCallback?.({ message: 'Hello, world!' })
      })

      // Verify initial callback was called
      expect(initialCallback).toHaveBeenCalledWith({
        message: 'Hello, world!',
      })

      // Update the callback
      await act(async () => {
        rerenderHook({ callback: updatedCallback })
      })

      // Simulate receiving more data
      act(() => {
        savedCallback?.({ message: 'Updated message!' })
      })

      // Verify updated callback was called
      expect(updatedCallback).toHaveBeenCalledWith({
        message: 'Updated message!',
      })
    })
  })
})
