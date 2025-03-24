import { useEffect, useRef } from 'react'
import { AppSyncEventsClient, SubscriptionInfo } from './appsync-events-client'

/**
 * React hook for subscribing to an AppSync Events channel.
 * Automatically handles subscription management and cleanup.
 *
 * @param client - The AppSyncEventsClient instance
 * @param channel - The channel name to subscribe to
 * @param callback - Callback function invoked when events are received
 * @returns The subscription info object if the subscription is active, otherwise undefined
 */
export function useChannel<T = any>(
  client: AppSyncEventsClient,
  channel: string,
  callback?: (data: T) => void,
) {
  const subscriptionRef = useRef<SubscriptionInfo>(undefined)
  const callbackRef = useRef(callback)

  // Update callback ref when it changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    // Skip if no client, channel, or callback
    if (!client || !channel || !callbackRef.current) {
      return
    }

    let isMounted = true

    const handleCallback = (data: T) => {
      if (isMounted && callbackRef.current) {
        callbackRef.current(data)
      }
    }

    // Subscribe to the channel
    client
      .subscribe<T>(channel, handleCallback)
      .then((subscription) => {
        if (isMounted) {
          subscriptionRef.current = subscription
        } else {
          // Component unmounted before subscription completed
          subscription.unsubscribe()
        }
      })
      .catch((error) => {
        console.error(`Error subscribing to channel ${channel}:`, error)
      })

    // Cleanup function to unsubscribe when unmounting
    return () => {
      isMounted = false

      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = undefined
      }
    }
  }, [client, channel]) // Only re-run if client or channel changes

  return subscriptionRef.current
}
