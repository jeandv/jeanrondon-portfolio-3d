import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Mesh,
  type SpotLight,
} from 'three'
import { CAPTURE } from '../../capture/mode'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import { LIGHT_RIG } from '../lightRig'
import { deskSpillCard } from './deskSpill'
import {
  averageLinear,
  BLACK,
  cardColor,
  chroma,
  dampRgb,
  GLOW_SMOOTH_TIME,
  power,
  SAMPLE_HEIGHT,
  SAMPLE_INTERVAL,
  SAMPLE_WIDTH,
  screenRadiance,
  type Rgb,
} from './tvSpill'

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Soft ellipse from the TV-side edge (v = 1), faded at the desk edge and the sides.
const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uReach;
varying vec2 vUv;
void main() {
  float x = (vUv.x - 0.5) * uSize.x;
  float d = (1.0 - vUv.y) * uSize.y;
  float r = length(vec2(x / uReach, d / (uReach * 0.75)));
  float fall = 1.0 - smoothstep(0.0, 1.0, r);
  fall *= fall;
  fall *= smoothstep(0.0, 0.012, uSize.y - d) * smoothstep(0.0, 0.04, 0.5 * uSize.x - abs(x));
  gl_FragColor = vec4(uColor * fall, 1.0);
}
`

/** Falloff radius (m) across the desk. */
const REACH = 0.42

function createSampler(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_WIDTH
  canvas.height = SAMPLE_HEIGHT
  return canvas.getContext('2d', { willReadFrequently: true })
}

export interface TvGlowProps {
  readonly room: Object3D
  readonly screen: CanvasScreen
  readonly mesh: Mesh
}

/**
 * The TV's light on the desk, following the channel colour: an additive glow
 * card (both modes) and, in greybox, a realtime spot in front of the glass.
 * The screen canvas is sampled at 8×6 every 200 ms (and on channel changes);
 * ?capture samples once and snaps, so the still is deterministic.
 */
export function TvGlow({ room, screen, mesh }: TvGlowProps) {
  const card = useMemo(() => deskSpillCard(room, mesh), [room, mesh])
  const sampler = useMemo(() => createSampler(), [])
  const tint = useMemo(() => new Color(0, 0, 0), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        name: 'M_tv_glow',
        uniforms: {
          uColor: { value: tint },
          uSize: { value: new Vector2(card?.width ?? 1, card?.depth ?? 1) },
          uReach: { value: REACH },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [card, tint],
  )
  const geometry = useMemo(() => (card ? new PlaneGeometry(card.width, card.depth) : null), [card])
  const light = useMemo(() => {
    mesh.updateWorldMatrix(true, false)
    const origin = mesh.getWorldPosition(new Vector3())
    const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld)
    const target = new Object3D()
    target.position.copy(origin).addScaledVector(normal, 0.6).add(new Vector3(0, -0.35, 0))
    return { position: origin.clone().addScaledVector(normal, 0.03), target }
  }, [mesh])
  const spotRef = useRef<SpotLight>(null)
  const state = useRef({ radiance: BLACK as Rgb, target: BLACK as Rgb, since: Number.POSITIVE_INFINITY, channel: '', sampled: false })

  useEffect(
    () => () => {
      material.dispose()
      geometry?.dispose()
    },
    [material, geometry],
  )

  useFrame((_, delta) => {
    const glow = state.current
    glow.since += delta
    const channel = screen.channelId ?? ''
    const due = CAPTURE ? !glow.sampled : glow.since >= SAMPLE_INTERVAL || channel !== glow.channel
    if (due && sampler && screen.drawCount > 0) {
      sampler.drawImage(screen.canvas, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
      glow.target = screenRadiance(averageLinear(sampler.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data))
      glow.since = 0
      glow.channel = channel
      glow.sampled = true
    }
    glow.radiance = CAPTURE ? glow.target : dampRgb(glow.radiance, glow.target, GLOW_SMOOTH_TIME, delta)

    const color = cardColor(glow.radiance)
    tint.setRGB(color.r, color.g, color.b)
    const spot = spotRef.current
    if (spot) {
      const hue = chroma(glow.radiance)
      spot.color.setRGB(hue.r, hue.g, hue.b)
      spot.intensity = LIGHT_RIG.tv.intensity * power(glow.radiance)
    }
  })

  return (
    <>
      {card && geometry && (
        <mesh
          geometry={geometry}
          material={material}
          position={card.center}
          quaternion={card.quaternion}
          renderOrder={1}
          userData={{ runtimeHelper: true }}
        />
      )}
      {LIGHT_RIG.tv.intensity > 0 && (
        <>
          <primitive object={light.target} />
          <spotLight
            ref={spotRef}
            position={light.position}
            target={light.target}
            intensity={0}
            angle={1.2}
            penumbra={1}
            decay={2}
          />
        </>
      )}
    </>
  )
}
