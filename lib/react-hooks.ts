import { useEffect, useRef, useState } from 'react'
import { AppSyncEventsClient, Channel } from './appsync-events-client'

/**
 * React hook for subscribing to an AppSync Events channel.
 * Automatically handles subscription management and cleanup.
 *
 * @param client - The AppSyncEventsClient instance
 * @param path - The channel path to subscribe to
 * @param callback - Optional callback function invoked when events are received
 * @returns A tuple containing [channel, isReady flag]
 */
export function useChannel<T = any>(
  client: AppSyncEventsClient,
  path: string,
  callback?: (data: T) => void,
) {
  const channelRef = useRef<Channel>(undefined)
  const callbackRef = useRef(callback)
  const [isReady, setIsReady] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<Error>()

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
        setIsReady(true)
        setIsError(false)
        setError(undefined)
      } else {
        channel.unsubscribe()
        setIsReady(false)
        setIsError(false)
        setError(undefined)
      }
    }

    const onError = (error: Error) => {
      setIsReady(false)
      setIsError(true)
      setError(error)
    }

    try {
      if (!callback) {
        client
          .getChannel(path)
          .then(handle, onError)
          .catch((error) => {
            console.error(`Error getting publishing channel ${path}:`, error)
          })
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
          .catch((error) => {
            console.error(`Error subscribing to channel ${path}:`, error)
          })
      }
    } catch (error) {
      setIsReady(false)
      setIsError(true)
      setError(error as Error)
    }

    // Cleanup function to unsubscribe when unmounting
    return () => {
      isMounted = false

      if (channelRef.current) {
        channelRef.current.unsubscribe()
        channelRef.current = undefined
        setIsReady(false)
      }
    }
  }, [client, client.connected, path]) // Only re-run if client or channel changes

  // Create a stable reference to the subscription that doesn't change on each render
  /**
   * Stable subscription reference that persists across renders
   * @internal
   */
  const channel: Channel = {
    id: channelRef.current?.id ?? 'n/a',
    publish: (...events: any[]) => channelRef.current?.publish(...events),
    unsubscribe: () => channelRef.current?.unsubscribe(),
  }

  return { channel, isReady, isError, error }
}
