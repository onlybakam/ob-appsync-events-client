import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { AppSyncEventsClient, useChannel } from '../lib/main'
import * as Auth from 'aws-amplify/auth'

const client = new AppSyncEventsClient(import.meta.env.VITE_HTTP_ENDPOINT, {
  // apiKey: import.meta.env.VITE_API_KEY,
  authorization: async () => {
    const session = await Auth.fetchAuthSession()
    return session.tokens?.idToken?.toString() ?? 'n/a'
  },
})
function App() {
  const [count, setCount] = useState(0)
  useChannel(client, '/default/*', (data) => console.log(data))
  const [pub, isReady] = useChannel(client, '/default/test')
  function handleclick() {
    pub?.publish("I'm the captain!")
  }

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>count is {count}</button>

        <button onClick={() => handleclick()}>Publish</button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">Click on the Vite and React logos to learn more</p>
    </>
  )
}

export default App
