/** AWS AppSync Events WebSocket subprotocol identifier */
export const AWS_APPSYNC_EVENTS_SUBPROTOCOL = 'aws-appsync-event-ws'

/**
 * Configuration options for AppSyncEventsClient
 * @public
 */
export interface ClientOptions {
  /** AWS region for the AppSync API */
  region?: string

  /** API key for apiKey authentication mode */
  apiKey?: string

  /** Authorization token for authentication, either a string token or a function that returns a Promise resolving to a token */
  authorization?: string | (() => Promise<string>)

  debug?: boolean
}

/**
 * Information about an active subscription
 * @public
 a*/
export type Channel = {
  /** Unique identifier for the subscription */
  id: string

  /** Function to unsubscribe from the channel */
  unsubscribe: () => void

  /** Function to publish directly to the channel */
  publish: (...events: any[]) => void
}

/**
 * Internal subscription state tracking
 * @internal
 */
interface Subscription<T> {
  /** Whether the subscription is connected and ready to receive data */
  ready: boolean

  /** Channel path this subscription is for */
  path: string

  /** Timestamp when the subscription was created */
  timestamp: number

  /** Subscription channel returned to consumers */
  channel?: Channel

  /** Callback function to invoke when data is received */
  callback: (data: T) => void

  /** Promise resolution function for subscription setup */
  resolve: (value: Channel) => void

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

/** event domain HTTP endpoint patttern */
const eventDomainPattern =
  /^(https:\/\/)?\w{26}\.\w+-api\.\w{2}(?:(?:-\w{2,})+)-\d\.amazonaws.com(?:\.cn)?(\/event)?$/i

///**
// * Determines if a URL is a custom domain rather than a standard AWS endpoint
// *
// * @public
// * @param url - The URL to check
// * @returns True if the URL is a custom domain
// */
//const isCustomDomain = (url: string): boolean => {
//  return url.match(eventDomainPattern) === null
//}

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

  public get connected() {
    return this.isConnected
  }

  public get status() {
    return this.ws?.readyState ?? -1
  }

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
    // realtimeEndpoint = realtimeEndpoint.replace('https://', '').replace('http://', '')
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
   * Retrieves the appropriate authentication headers
   *
   * @internal
   * @returns Promise resolving to authentication headers object for API requests
   * @throws Error if no valid authentication configuration is found
   */
  private async getAuthHeaders() {
    if (this.options.apiKey) {
      return { 'x-api-key': this.options.apiKey }
    }
    if (this.options.authorization) {
      const authorization =
        typeof this.options.authorization === 'string'
          ? this.options.authorization
          : await this.options.authorization()
      return { authorization }
    }
    throw new Error('Please specify an authorization mode')
  }

  private debug(message?: any, ...optionalParams: any[]) {
    if (this.options.debug) {
      console.log('AppSyncEventsClient:', message, ...optionalParams)
    }
  }

  /**
   * Establishes a WebSocket connection to the AppSync Events API
   *
   * If a connection is already in progress, returns the existing promise.
   * Automatically handles token renewal if authorization is provided as a function.
   * @public
   * @returns Promise that resolves with the client when connected
   */
  public async connect(): Promise<AppSyncEventsClient> {
    if (this.connection) {
      return this.connection
    }
    this.connection = this.getAuthHeaders().then((header) => {
      return new Promise((resolve, reject) => {
        try {
          const headers = getAuthProtocol({
            host: new URL(`https://${this.httpEndpoint}/event`).hostname,
            ...header,
          })
          this.ws = new WebSocket(this.realTimeUrl, [AWS_APPSYNC_EVENTS_SUBPROTOCOL, headers])

          this.ws.onopen = () => {
            this.debug('WebSocket connection established', this.ws?.readyState)
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.isConnected = true
              this.reconnectAttempts = 0
              resolve(this)
            }
          }

          this.ws.onclose = (event) => {
            this.debug('WebSocket connection closed', event.reason)
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
              console.error('Unexpected message:', error)
            }
          }
        } catch (error) {
          reject(error)
        }
      })
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
      this.debug(`Attempting to reconnect in ${delay}ms...`)

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
    this.debug('Unexpected error', message)
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
    this.debug(`Error subscribing to channel ${subscription.path}`)
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
    this.debug(`subscription ${message.id} ready`)
    subscription.ready = true
    subscription.channel = {
      id: message.id,
      unsubscribe: () => this.unsubscribe(message.id),
      publish: (...data) => this.publish(subscription.path, ...data),
    }
    subscription.resolve(subscription.channel)
  }

  /**
   * Handles incoming data messages and routes them to the appropriate callback
   * @internal
   * @param message - Data message from server
   */
  private handleData(message: ProtocolMessage.DataMessage): void {
    const subscription = this.subscriptions.get(message.id)
    if (!subscription || !subscription.ready) {
      console.error(`Subscription not ready: ${message.id}`)
      return
    }
    this.debug(`Received data on subscription ${message.id}:`, message.event)
    subscription.callback(JSON.parse(message.event))
  }

  /**
   * Publishes data to a specified channel
   *
   * @public
   * @param channel - The channel to publish to
   * @param data - The data to publish (will be serialized to JSON)
   * @returns Promise that resolves when the publish operation completes
   * @throws Error if not connected to WebSocket
   */
  public async publish(channel: string, ...data: any[]) {
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
      authorization: await this.getAuthHeaders(),
    }

    this.ws.send(JSON.stringify(publishMessage))
  }

  /**
   * Gets a channel for publishing without subscribing to events
   *
   * @public
   * @param path - The channel path to publish to
   * @returns A subscription info object that can be used for publishing only
   */
  public async getChannel(path: string) {
    await this.connect()
    return {
      id: '<not-subscribed>',
      unsubscribe: () => {}, //no-op
      publish: (...data: any[]) => this.publish(path, ...data),
    } as Channel
  }

  /**
   * Subscribes to a channel path to receive data
   *
   * Automatically handles authentication token retrieval or renewal.
   * @public
   * @param path - The channel path to subscribe to
   * @param callback - Function to call when data is received on this channel
   * @param subscriptionId - Optional custom subscription ID (generated if not provided)
   * @returns Promise resolving to Channel when subscription is confirmed
   * @throws Error if connection fails or subscription request is rejected
   */
  public async subscribe<T = any>(
    path: string,
    callback: (data: T) => void,
    subscriptionId?: string,
  ) {
    await this.connect()
    const authorization = await this.getAuthHeaders()
    return new Promise<Channel>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not ready'))
      }

      const id = subscriptionId ?? crypto.randomUUID()
      this.subscriptions.set(id, {
        path,
        timestamp: Date.now(),
        ready: false,
        callback,
        resolve,
        reject,
      })
      const subscribeMessage: ProtocolMessage.SubscribeMessage = {
        type: 'subscribe',
        id,
        channel: path,
        authorization,
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
