import { useEffect, useRef, useState } from 'react'
import { AppSyncEventsClient, SubscriptionInfo } from './appsync-events-client'

/**
 * React hook for subscribing to an AppSync Events channel.
 * Automatically handles subscription management and cleanup.
 *
 * @param client - The AppSyncEventsClient instance
 * @param channel - The channel name to subscribe to
 * @param callback - Optional callback function invoked when events are received
 * @returns The subscription info object if the subscription is active, otherwise undefined
 */
export function useChannel<T = any>(
  client: AppSyncEventsClient,
  channel: string,
  callback?: (data: T) => void,
): [SubscriptionInfo, boolean] {
  const subscriptionRef = useRef<SubscriptionInfo>(undefined)
  const callbackRef = useRef(callback)
  const [isReady, setIsReady] = useState(false)

  // Update callback ref when it changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    // Skip if no client or channel
    if (!client || !channel) {
      return
    }

    let isMounted = true

    const handle = (subscription: SubscriptionInfo) => {
      if (isMounted) {
        subscriptionRef.current = subscription
        setIsReady(true)
      } else {
        subscription.unsubscribe()
        setIsReady(false)
      }
    }

    if (!callback) {
      client
        .getChannel(channel)
        .then(handle)
        .catch((error) => {
          console.error(`Error getting publishing channel ${channel}:`, error)
        })
    } else {
      const handleCallback = (data: T) => {
        if (isMounted && callbackRef.current) {
          callbackRef.current(data)
        }
      }
      // Subscribe to the channel
      client
        .subscribe<T>(channel, handleCallback)
        .then(handle)
        .catch((error) => {
          console.error(`Error subscribing to channel ${channel}:`, error)
        })
    }

    // Cleanup function to unsubscribe when unmounting
    return () => {
      isMounted = false

      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = undefined
        setIsReady(false)
      }
    }
  }, [client, channel]) // Only re-run if client or channel changes

  // wrap ref inside a SubscriptionInfo
  const x: SubscriptionInfo = {
    id: subscriptionRef.current?.id ?? 'n/a',
    publish: (...events: any[]) => subscriptionRef.current?.publish(...events),
    unsubscribe: () => subscriptionRef.current?.unsubscribe(),
  }

  return [x, isReady]
}
