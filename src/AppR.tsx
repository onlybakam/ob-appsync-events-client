import { Authenticator } from '@aws-amplify/ui-react'
import { Amplify } from 'aws-amplify'
import '@aws-amplify/ui-react/styles.css'
import outputs from './config.json'
import App from './App.tsx'

Amplify.configure(outputs)

export default function AppR() {
  return (
    <Authenticator>
      {({ signOut, user }) => {
        return <App />
      }}
    </Authenticator>
  )
}
