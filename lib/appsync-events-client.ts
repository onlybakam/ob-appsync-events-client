/**
 * AWS AppSync Events WebSocket subprotocol identifier
 * @internal
 */
const AWS_APPSYNC_EVENTS_SUBPROTOCOL = 'aws-appsync-event-ws'

/**
 * Configuration options for AppSyncEventsClient
 * @public
 */
export interface ClientOptions {
  /** AWS region for the AppSync API */
  region?: string

  /** Authentication mode to use when connecting to AppSync */
  authMode?: 'apiKey' | 'COGNITO_USER_POOLS' | 'OIDC' | 'CUSTOM'

  /** API key for apiKey authentication mode */
  apiKey?: string

  /** Authorization token for COGNITO_USER_POOLS, OIDC, or CUSTOM authentication modes */
  authorization?: string
}

/**
 * Information about an active subscription
 * @public
 a*/
export type SubscriptionInfo = {
  /** Unique identifier for the subscription */
  id: string

  /** Function to unsubscribe from the channel */
  unsubscribe: () => void

  publish: (...events: any[]) => void
}

/**
 * Internal subscription state tracking
 * @internal
 */
interface Subscription<T> {
  /** Whether the subscription is connected and ready to receive data */
  ready: boolean

  /** Channel name this subscription is for */
  channel: string

  /** Timestamp when the subscription was created */
  timestamp: number

  /** Subscription info returned to consumers */
  info?: SubscriptionInfo

  /** Callback function to invoke when data is received */
  callback: (data: T) => void

  /** Promise resolution function for subscription setup */
  resolve: (value: SubscriptionInfo) => void

  /** Promise rejection function for subscription setup */
  reject: (reason?: unknown) => unknown
}

/**
 * Authentication protocol for AppSync operations
 * @internal
 */
type AuthProtocol = { 'x-api-key': string } | { authorization: string }

/**
 * Authentication protocol for WebSocket connection
 * @internal
 */
type ConnectAuthProtocol =
  | { 'x-api-key': string; host: string }
  | { authorization: string; host: string }

/**
 * Union type of all possible protocol messages exchanged with the AppSync WebSocket API
 * @internal
 */
type ProtocolMessage =
  | ProtocolMessage.KaMessage
  | ProtocolMessage.ConnectionInitMessage
  | ProtocolMessage.ConnectionAckMessage
  | ProtocolMessage.SubscribeMessage
  | ProtocolMessage.SubscribeSuccessMessage
  | ProtocolMessage.SubscribeErrorMessage
  | ProtocolMessage.UnsubscribeMessage
  | ProtocolMessage.UnsubscribeErrorMessage
  | ProtocolMessage.UnsubscribeSuccessMessage
  | ProtocolMessage.UnsubscribeErrorMessage
  | ProtocolMessage.DataMessage
  | ProtocolMessage.PublishMessage
  | ProtocolMessage.PublishSuccessMessage
  | ProtocolMessage.PublishErrorMessage
  | ProtocolMessage.ErrorMessage

export namespace ProtocolMessage {
  export interface KaMessage {
    type: 'ka'
  }
  export interface ConnectionInitMessage {
    type: 'connection_init'
  }
  export interface ConnectionAckMessage {
    type: 'connection_ack'
    connectionTimeoutMs: number
  }
  export interface SubscribeMessage {
    type: 'subscribe'
    id: string
    channel: string
    authorization: AuthProtocol
  }
  export interface SubscribeSuccessMessage {
    type: 'subscribe_success'
    id: string
  }
  export interface SubscribeErrorMessage {
    type: 'subscribe_error'
    id: string
    errors?: ProtocolError[]
  }
  export interface UnsubscribeMessage {
    type: 'unsubscribe'
    id: string
  }
  export interface UnsubscribeSuccessMessage {
    type: 'unsubscribe_success'
    id: string
  }
  export interface UnsubscribeErrorMessage {
    type: 'unsubscribe_error'
    id: string
    errors?: ProtocolError[]
  }
  export interface DataMessage {
    type: 'data'
    id: string
    event: string
  }
  export interface PublishMessage {
    type: 'publish'
    id: string
    channel: string
    events: string[]
    authorization: AuthProtocol
  }
  export interface PublishSuccessMessage {
    type: 'publish_success'
    id: string
    successful: { identifier: string; index: number }[]
    failed: { identifier: string; index: number }[]
  }
  export interface PublishErrorMessage {
    type: 'publish_error'
    id: string
    errors: ProtocolError[]
  }
  export interface ErrorMessage {
    type: 'error'
    id?: string
    errors?: ProtocolError[]
  }
}

/**
 * Error structure returned by the AppSync protocol
 * @internal
 */
interface ProtocolError {
  /** Type of error that occurred */
  errorType: string
  /** Human-readable error message */
  message: string
}

/**
 * Formats authentication data for the WebSocket subprotocol header
 *
 * @internal
 * @param auth - Authentication data to encode
 * @returns Formatted header string
 */
function getAuthProtocol(auth: ConnectAuthProtocol): string {
  const based64UrlHeader = btoa(JSON.stringify(auth))
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove padding `=`
  return `header-${based64UrlHeader}`
}

/**
 * Converts an array of protocol errors to a human-readable string
 *
 * @internal
 * @param errors - Array of protocol errors
 * @returns Error message string
 */
function errorsToString(errors: ProtocolError[]) {
  const first = errors[0]
  return first ? `${first.errorType}: ${first.message}` : 'Unknown error'
}

const eventDomainPattern =
  /^(https:\/\/)?\w{26}\.\w+-api\.\w{2}(?:(?:-\w{2,})+)-\d\.amazonaws.com(?:\.cn)?(\/event)?$/i

/**
 * Determines if a URL is a custom domain rather than a standard AWS endpoint
 *
 * @public
 * @param url - The URL to check
 * @returns True if the URL is a custom domain
 */
export const isCustomDomain = (url: string): boolean => {
  return url.match(eventDomainPattern) === null
}

/**
 * Determines if a URL is a standard AWS AppSync endpoint
 *
 * @internal
 * @param url - The URL to check
 * @returns True if the URL is a standard AWS endpoint
 */
const isEventDomain = (url: string): boolean => url.match(eventDomainPattern) !== null

/**
 * Client for AWS AppSync Events API
 *
 * Provides WebSocket-based publish/subscribe capabilities for AppSync event channels
 * @public
 */
export class AppSyncEventsClient {
  /** Active WebSocket connection */
  private ws: WebSocket | null = null

  /** Map of active subscriptions by subscription ID */
  private subscriptions = new Map<string, Subscription<any>>()

  /** Connection state flag */
  private isConnected = false

  /** Current count of reconnection attempts */
  private reconnectAttempts = 0

  /** Promise for the connection process */
  private connection: Promise<AppSyncEventsClient> | null = null

  /** Maximum number of reconnection attempts before giving up */
  private readonly maxReconnectAttempts = 5

  /** Base reconnection delay in milliseconds (increases with backoff) */
  private readonly reconnectDelay = 1_000

  /**
   * Converts HTTP endpoint to WebSocket URL
   * @internal
   */
  private get realTimeUrl() {
    const protocol = 'wss://'
    const realtimePath = '/event/realtime'
    let realtimeEndpoint = this.httpEndpoint

    if (isEventDomain(realtimeEndpoint)) {
      realtimeEndpoint = realtimeEndpoint
        .replace('ddpg-api', 'grt-gamma')
        .replace('appsync-api', 'appsync-realtime-api')
    }
    realtimeEndpoint = realtimeEndpoint.replace('https://', '').replace('http://', '')

    return protocol.concat(realtimeEndpoint, realtimePath)
  }

  /**
   * Creates a new AppSyncEventsClient
   *
   * @param httpEndpoint - The HTTP endpoint of the AppSync API
   * @param options - Configuration options for the client
   */
  constructor(
    private readonly httpEndpoint: string,
    private readonly options: ClientOptions,
  ) {}

  /**
   * Retrieves the appropriate authentication headers based on the configured auth mode
   *
   * @internal
   * @returns Authentication headers object for API requests
   * @throws Error if no valid authentication configuration is found
   */
  private getAuthHeaders() {
    const authMode = this.options.authMode
    if ((!authMode || authMode === 'apiKey') && this.options.apiKey) {
      return { 'x-api-key': this.options.apiKey }
    }
    if (
      (authMode === 'COGNITO_USER_POOLS' || authMode === 'OIDC' || authMode === 'CUSTOM') &&
      this.options.authorization
    ) {
      return { authorization: this.options.authorization }
    }
    throw new Error('Please specify an authorization mode')
  }

  /**
   * Establishes a WebSocket connection to the AppSync Events API
   *
   * If a connection is already in progress, returns the existing promise
   * @public
   * @returns Promise that resolves with the client when connected
   */
  public connect(): Promise<AppSyncEventsClient> {
    if (this.connection) {
      return this.connection
    }
    this.connection = new Promise((resolve, reject) => {
      try {
        const headers = getAuthProtocol({
          host: this.httpEndpoint.replace('https://', '').replace('/event', ''),
          ...this.getAuthHeaders(),
        })
        this.ws = new WebSocket(this.realTimeUrl, [AWS_APPSYNC_EVENTS_SUBPROTOCOL, headers])

        this.ws.onopen = () => {
          console.log('WebSocket connection established', this.ws?.readyState)
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.isConnected = true
            this.reconnectAttempts = 0
            resolve(this)
          }
        }

        this.ws.onclose = (event) => {
          console.log('WebSocket connection closed', event.reason)
          this.isConnected = false
          this.handleReconnect()
        }

        this.ws.onerror = (error: Event) => {
          console.error('WebSocket error:', error)
          reject(error)
        }

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data) as ProtocolMessage
            if (message.type === 'data') {
              this.handleData(message)
            } else if (message.type === 'subscribe_success') {
              this.handleSubscribeSuccess(message)
            } else if (message.type === 'subscribe_error') {
              this.handlerSubscribeError(message)
            } else if (message.type === 'error') {
              this.handleError(message)
            }
          } catch (error) {
            console.error('Error handling message:', error)
          }
        }
      } catch (error) {
        reject(error)
      }
    })
    return this.connection
  }

  /**
   * Handles reconnection attempts with exponential backoff
   * @internal
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = this.reconnectDelay * 2 ** (this.reconnectAttempts - 1)
      console.log(`Attempting to reconnect in ${delay}ms...`)

      setTimeout(() => {
        this.connect().catch((error) => console.error('Reconnection failed:', error))
      }, delay)
    } else {
      console.error('Max reconnection attempts reached')
    }
  }

  /**
   * Handles general protocol error messages
   * @internal
   * @param message - Error message from server
   */
  private handleError(message: ProtocolMessage.ErrorMessage) {
    console.log('Unexpected error', message)
  }

  /**
   * Handles subscription error messages
   * @internal
   * @param message - Subscribe error message from server
   */
  private handlerSubscribeError(message: ProtocolMessage.SubscribeErrorMessage) {
    const subscription = this.subscriptions.get(message.id)
    if (!subscription) {
      return
    }
    console.log(`Error subscribing to channel ${subscription.channel}`)
    subscription.reject(new Error(errorsToString(message.errors ?? [])))
    this.subscriptions.delete(message.id)
  }

  /**
   * Handles successful subscription confirmations
   * @internal
   * @param message - Subscribe success message from server
   */
  private handleSubscribeSuccess(message: ProtocolMessage.SubscribeSuccessMessage) {
    const subscription = this.subscriptions.get(message.id)
    if (!subscription) {
      return
    }
    console.log(`subscription ${message.id} ready`)
    subscription.ready = true
    subscription.info = {
      id: message.id,
      unsubscribe: () => this.unsubscribe(message.id),
      publish: (...data) => this.publish(subscription.channel, ...data),
    }
    subscription.resolve(subscription.info)
  }

  /**
   * Handles incoming data messages and routes them to the appropriate callback
   * @internal
   * @param message - Data message from server
   */
  private handleData(message: ProtocolMessage.DataMessage): void {
    const subscription = this.subscriptions.get(message.id)
    if (!subscription || !subscription.ready) {
      console.error('Subscription not ready')
      return
    }
    subscription.callback(JSON.parse(message.event))
  }

  /**
   * Publishes data to a specified channel
   *
   * @public
   * @param channel - The channel to publish to
   * @param data - The data to publish (will be serialized to JSON)
   * @throws Error if not connected to WebSocket
   */
  public publish(channel: string, ...data: any[]): void {
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket is not connected')
    }

    if (channel.endsWith('/*')) {
      throw new Error(`Cannot publish to channel with '*' in path: ${channel}`)
    }

    if (data.length === 0 || data.length > 5) {
      throw new Error('You can publish up to 5 events at a time')
    }

    const publishMessage: ProtocolMessage.PublishMessage = {
      id: crypto.randomUUID(),
      type: 'publish',
      channel,
      events: data.map((d) => JSON.stringify(d)),
      authorization: this.getAuthHeaders(),
    }

    this.ws.send(JSON.stringify(publishMessage))
  }

  /**
   * Gets a channel for publishing without subscribing to events
   *
   * @public
   * @param channel - The channel name to publish to
   * @returns A subscription info object that can be used for publishing only
   */
  public async getChannel(channel: string) {
    await this.connect()
    return Promise.resolve<SubscriptionInfo>({
      id: '<not-subscribed>',
      unsubscribe: () => {}, //no-op
      publish: (...data: any[]) => this.publish(channel, ...data),
    })
  }

  /**
   * Subscribes to a channel to receive data
   *
   * @public
   * @param channel - The channel to subscribe to
   * @param callback - Function to call when data is received on this channel
   * @param subscriptionId - Optional custom subscription ID (generated if not provided)
   * @returns Promise resolving to subscription info when subscription is confirmed
   * @throws Error if connection fails or subscription request is rejected
   */
  public async subscribe<T = any>(
    channel: string,
    callback: (data: T) => void,
    subscriptionId?: string,
  ) {
    await this.connect()
    return new Promise<SubscriptionInfo>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not ready'))
      }

      const id = subscriptionId ?? crypto.randomUUID()
      this.subscriptions.set(id, {
        channel,
        timestamp: Date.now(),
        ready: false,
        callback,
        resolve,
        reject,
      })
      const subscribeMessage: ProtocolMessage.SubscribeMessage = {
        type: 'subscribe',
        id,
        channel,
        authorization: this.getAuthHeaders(),
      }
      this.ws?.send(JSON.stringify(subscribeMessage))
    })
  }

  /**
   * Unsubscribes from a channel
   * @internal
   * @param subscriptionId - The ID of the subscription to remove
   * @throws Error if not connected to WebSocket
   */
  private unsubscribe(subscriptionId: string): void {
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket is not connected')
    }

    const unsubscribeMessage: ProtocolMessage.UnsubscribeMessage = {
      type: 'unsubscribe',
      id: subscriptionId,
    }

    this.ws.send(JSON.stringify(unsubscribeMessage))
    this.subscriptions.delete(subscriptionId)
  }

  /**
   * Disconnects the WebSocket and clears all subscriptions
   *
   * @public
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.subscriptions.clear()
      this.isConnected = false
    }
  }
}
