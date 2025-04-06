import { useCallback, useEffect, useRef } from 'react'
import { AppSyncEventsClient, Channel, ClientNotPublished } from './appsync-events-client'

/**
 * React hook for subscribing to an AppSync Events channel.
 * Automatically handles subscription management and cleanup.
 *
 * This hook manages the lifecycle of a channel subscription, including:
 * - Creating and maintaining the subscription
 * - Handling connection state changes
 * - Proper cleanup on unmount
 * - Error handling
 *
 * @param client - The AppSyncEventsClient instance
 * @param path - The channel path to subscribe to
 * @param callback - Optional callback function invoked when events are received
 * @returns Object containing {channel, isReady, isError, error}
 */
export function useChannel<T = any>(
  client: AppSyncEventsClient,
  path: string,
  callback?: (data: T) => void,
) {
  const channelRef = useRef<Channel>(undefined)
  const callbackRef = useRef(callback)

  // Update callback ref when it changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    // Skip if no client or channel
    if (!client || !path) {
      return
    }

    let isMounted = true

    const handle = (channel: Channel) => {
      if (isMounted) {
        channelRef.current = channel
      } else {
        channel.unsubscribe()
      }
    }

    const onError = (error: Error) => {
      console.warn(error)
    }

    try {
      if (!callback) {
        client
          .getChannel(path)
          .then(handle, onError)
          .catch((error) => onError(error))
      } else {
        const handleCallback = (data: T) => {
          if (isMounted && callbackRef.current) {
            callbackRef.current(data)
          }
        }
        // Subscribe to the channel
        client
          .subscribe<T>(path, handleCallback)
          .then(handle, onError)
          .catch((error) => onError(error))
      }
    } catch (error) {
      console.warn(error)
    }

    // Cleanup function to unsubscribe when unmounting
    return () => {
      isMounted = false

      if (channelRef.current) {
        channelRef.current.unsubscribe()
        channelRef.current = undefined
      }
    }
  }, [client, client.connected, path]) // Only re-run if client or channel changes

  return {
    isReady: useCallback(() => !!channelRef.current, []),
    unsubscribe: useCallback(() => {
      channelRef.current?.unsubscribe()
    }, []),
    publish: useCallback((...events: any[]) => {
      if (channelRef.current) {
        return channelRef.current.publish(...events)
      }
      return Promise.resolve<ClientNotPublished>({
        type: 'client_not_published',
      })
    }, []),
  }
}
