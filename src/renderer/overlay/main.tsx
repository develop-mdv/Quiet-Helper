import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayApp } from './App'
import '../styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
