import { createStore } from 'zustand/vanilla'
import { INITIAL_SIGNALS, type BootSignals } from './progress'

/**
 * Gate conditions reported by both chunks: fonts from main.tsx, network
 * bytes / assets / compile / frames from the 3D chunk (three-free, so the
 * loader UI can read it before three is downloaded).
 */
export interface BootSignalsStore extends BootSignals {
  setNetwork: (fraction: number) => void
  markAssets: () => void
  markFonts: () => void
  markCompiled: () => void
  setFrames: (frames: number) => void
}

export const bootSignals = createStore<BootSignalsStore>()((set) => ({
  ...INITIAL_SIGNALS,
  setNetwork: (fraction) => set((state) => (fraction > state.network ? { network: Math.min(1, fraction) } : state)),
  markAssets: () => set((state) => (state.assets ? state : { assets: true })),
  markFonts: () => set((state) => (state.fonts ? state : { fonts: true })),
  markCompiled: () => set((state) => (state.compiled ? state : { compiled: true })),
  setFrames: (frames) => set((state) => (frames > state.frames ? { frames } : state)),
}))
