# AppSync Events Client

A lightweight TypeScript client for AWS AppSync Events API with React hooks support.

[![NPM Version](https://img.shields.io/npm/v/ob-appsync-events-client)](https://www.npmjs.com/package/ob-appsync-events-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Overview

This library provides a client for interacting with [AWS AppSync Events API](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-welcome.html), enabling real-time event publishing and subscription capabilities for your applications. It offers a streamlined interface for connecting to AppSync WebSocket endpoints with automatic reconnection support, flexible authentication options, and React hooks for easy integration.

AWS AppSync Events allows you to build scalable real-time applications that can broadcast events to millions of subscribers without managing complex WebSocket infrastructure.

## Features

- 🔄 WebSocket-based real-time event subscriptions
- 🔒 Multiple authentication methods support (API Key, Cognito, OIDC, Custom)
- 🔌 Automatic reconnection with exponential backoff
- 🚀 Custom domain support
- 🧩 React hooks for seamless integration with React applications
- 📦 Lightweight with minimal dependencies
- 📝 Full TypeScript support with proper type definitions

## Installation

```bash
npm install ob-appsync-events-client
```

## Basic Usage

### Vanilla JavaScript/TypeScript

```typescript
import { AppSyncEventsClient } from "ob-appsync-events-client";

// Initialize the client
const client = new AppSyncEventsClient(
  "https://your-appsync-endpoint.appsync-api.region.amazonaws.com/event",
  {
    apiKey: "your-api-key", // For API Key auth mode
    // OR
    // authMode: 'COGNITO_USER_POOLS',
    // authorization: 'your-cognito-token',
  },
);

// Connect to AppSync Events API
await client.connect();

// Subscribe to a channel
const subscription = await client.subscribe("myChannel", (data) => {
  console.log("Received data:", data);
});

// Publish to a channel
client.publish("myChannel", { message: "Hello, world!" });

// Later, unsubscribe when done
subscription.unsubscribe();

// Disconnect when completely done
client.disconnect();
```

### React Integration

```tsx
import { useChannel } from "ob-appsync-events-client";
import { AppSyncEventsClient } from "ob-appsync-events-client";

// Create client instance (best done outside component or in a context)
const client = new AppSyncEventsClient(
  "https://your-appsync-endpoint.appsync-api.region.amazonaws.com/event",
  {
    apiKey: "your-api-key",
  },
);

function MyComponent() {
  // Subscribe to messages
  const [subscription, isReady] = useChannel(client, "myChannel", (data) => {
    console.log("New message:", data);
  });

  // Send a message
  const sendMessage = () => {
    if (isReady) {
      subscription.publish({
        text: "Hello from React!",
        timestamp: Date.now(),
      });
    }
  };

  return (
    <div>
      <p>Connection status: {isReady ? "Connected" : "Connecting..."}</p>
      <button onClick={sendMessage} disabled={!isReady}>
        Send Message
      </button>
    </div>
  );
}
```

## API Reference

### `AppSyncEventsClient`

The main client for interacting with AWS AppSync Events API.

#### Constructor

```typescript
constructor(httpEndpoint: string, options: ClientOptions)
```

- `httpEndpoint`: The HTTP endpoint of your AppSync API
- `options`: Configuration options
  - `region?`: AWS region (optional)
  - `authMode?`: Authentication mode ('apiKey', 'COGNITO_USER_POOLS', 'OIDC', 'CUSTOM')
  - `apiKey?`: API key for apiKey authentication mode
  - `authorization?`: Authorization token for COGNITO_USER_POOLS, OIDC, or CUSTOM authentication modes

#### Methods

- `connect()`: Establishes a WebSocket connection
- `subscribe<T>(channel: string, callback: (data: T) => void, subscriptionId?: string)`: Subscribes to a channel
- `publish(channel: string, ...data: any[])`: Publishes data to a channel
- `getChannel(channel: string)`: Gets a channel for publishing without subscribing
- `disconnect()`: Closes the WebSocket connection and cleans up resources

### React Hooks

#### `useChannel<T>`

```typescript
function useChannel<T>(
  client: AppSyncEventsClient,
  channel: string,
  callback?: (data: T) => void,
): [SubscriptionInfo, boolean];
```

A React hook for subscribing to an AppSync Events channel, handling subscription lifecycle and cleanup automatically.

- `client`: The AppSyncEventsClient instance
- `channel`: The channel name to subscribe to
- `callback`: Optional callback function invoked when events are received
- Returns: A tuple containing:
  - `SubscriptionInfo`: Object with subscription details and methods
  - `boolean`: Ready state flag indicating if the subscription is active

## Authentication

The library supports all authentication methods available in AWS AppSync:

### API Key

```typescript
const client = new AppSyncEventsClient(endpoint, {
  apiKey: "your-api-key",
});
```

### Cognito User Pools

```typescript
const client = new AppSyncEventsClient(endpoint, {
  authMode: "COGNITO_USER_POOLS",
  authorization: "your-cognito-token", // JWT token from Cognito
});
```

### OpenID Connect

```typescript
const client = new AppSyncEventsClient(endpoint, {
  authMode: "OIDC",
  authorization: "your-oidc-token",
});
```

### Custom Authentication

```typescript
const client = new AppSyncEventsClient(endpoint, {
  authMode: "CUSTOM",
  authorization: "your-custom-token", // Generated by your Lambda authorizer
});
```

## Use Cases

- Real-time chat applications
- Live dashboards and analytics
- Sports and gaming updates
- Collaborative editing tools
- Notification systems
- IoT device monitoring

## Browser Compatibility

This library works in all modern browsers that support WebSockets and JavaScript Promises. It does not require any polyfills for most environments.

## Development

### Building the library

```bash
npm run build
```

### Running the demo app

```bash
npm run dev
```

## License

MIT

## Resources

- [AWS AppSync Events API Documentation](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-welcome.html)
- [AWS AppSync Developer Guide](https://docs.aws.amazon.com/appsync/latest/devguide/what-is-appsync.html)

