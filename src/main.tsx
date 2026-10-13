import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts: Archivo (wdth + wght axes), VT323, Caveat, JetBrains Mono.
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/vt323/index.css'
import '@fontsource-variable/caveat/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './styles/tokens.css'
import './styles/ui.css'
import App from './App.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
