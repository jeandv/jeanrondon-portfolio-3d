import { Bloom, createEffectComponent, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { HalfFloatType } from 'three'
import { CAPTURE } from '../../capture/mode'
import { useStore } from '../../state/store'
import { registerDevComposer } from '../dev/renderInfo'
import { FilmEffect, type FilmEffectOptions } from './FilmEffect'
import { LensEffect, type LensEffectOptions } from './LensEffect'

type LensProps = Omit<LensEffectOptions, 'blendFunction'>
type FilmProps = Omit<FilmEffectOptions, 'blendFunction'>

// Live props: R3F assigns them to the effect's setters (no shader rebuild).
const Lens = createEffectComponent<typeof LensEffect, LensProps>(LensEffect)
const Film = createEffectComponent<typeof FilmEffect, FilmProps>(FilmEffect)

/**
 * Post chain (plan §5.8). The composer renders the scene into an MSAA
 * HalfFloat target (linear HDR, NoToneMapping on the renderer), then one
 * merged EffectPass runs Lens (convolution, sorted first) → Bloom → Film
 * (exposure 1.8, vignette, grain) → AgX, and encodes to sRGB on output.
 * Bloom thresholds the pre-exposure linear scene: only the CRT whites (~1.4)
 * and the boosted city lights (> .88 luminance) bloom, walls stay below.
 */
export function PostFX() {
  const msaa = useStore((state) => state.device.msaa)
  const reducedMotion = useStore((state) => state.reducedMotion)
  return (
    <EffectComposer
      multisampling={msaa}
      frameBufferType={HalfFloatType}
      // Dev: lets window.__renderInfo() list the passes.
      ref={import.meta.env.DEV ? registerDevComposer : undefined}
    >
      <Lens barrel={0.02} ca={0.008} />
      <Bloom mipmapBlur intensity={0.45} luminanceThreshold={0.88} luminanceSmoothing={0.08} radius={0.5} />
      <Film vignette={0.8} grain={0.009} exposure={1.8} animated={!reducedMotion && !CAPTURE} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  )
}
