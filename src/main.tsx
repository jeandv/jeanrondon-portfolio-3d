import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts: Archivo (wdth + wght axes), VT323, Caveat, JetBrains Mono, Courier Prime (credits card).
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/vt323/index.css'
import '@fontsource-variable/caveat/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource/courier-prime/700.css'
import './styles/tokens.css'
import './styles/ui.css'
import './styles/seo.css'
import './styles/loader.css'
import App from './App.tsx'
import { bootSignals } from './boot/signals'
import { loadScreenFonts } from './screens/fonts'

// Start the canvas fonts now, in parallel with the lazy 3D chunk (the screens
// wait for them); settling them is one of the gate conditions.
void loadScreenFonts().then(() => bootSignals.getState().markFonts())

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// The build prerenders the SEO layer into #seo; in dev the slot is empty.
const seo = document.getElementById('seo')
if (seo && seo.childElementCount === 0) {
  void import('./seo/mountSeo').then(({ mountSeo }) => mountSeo(seo))
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
