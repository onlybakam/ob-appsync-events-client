import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppR from './AppR.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppR />
  </StrictMode>,
)
