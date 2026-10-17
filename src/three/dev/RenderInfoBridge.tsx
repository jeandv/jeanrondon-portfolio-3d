import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three'
import { useStore } from '../../state/store'
import { boxOfNodes } from '../camera/frames'
import {
  devComposerPasses,
  EMPTY_STATS,
  subtractStats,
  summarizeMaterials,
  type DrawStats,
  type RenderInfoSnapshot,
} from './renderInfo'

/** Runs before every other frame callback / after the composer (priority 1). */
const FIRST = -1000
const LAST = 1000

function drawStats(renderer: WebGLRenderer): DrawStats {
  const { calls, triangles, points, lines } = renderer.info.render
  return { calls, triangles, points, lines }
}

function findRoom(scene: Object3D): Object3D | undefined {
  let room: Object3D | undefined
  scene.traverse((object) => {
    if (!room && typeof object.userData.materialMode === 'string') room = object
  })
  return room
}

/**
 * Dev-only `window.__renderInfo()`. renderer.info auto-resets on every
 * render() call, and the composer renders several times per frame, so it is
 * switched to manual reset just around each frame to total scene + post.
 * The scene alone is measured on demand with one offscreen render.
 */
export function RenderInfoBridge() {
  const get = useThree((state) => state.get)
  const last = useRef<DrawStats>(EMPTY_STATS)

  useFrame(({ gl }) => {
    gl.info.autoReset = false
    gl.info.reset()
  }, FIRST)

  useFrame(({ gl }) => {
    last.current = drawStats(gl)
    gl.info.autoReset = true
  }, LAST)

  useEffect(() => {
    const measureScene = (): DrawStats => {
      const { gl, scene, camera, size } = get()
      const target = new WebGLRenderTarget(Math.max(1, size.width), Math.max(1, size.height))
      const previous = gl.getRenderTarget()
      const autoReset = gl.info.autoReset
      gl.info.autoReset = false
      gl.info.reset()
      gl.setRenderTarget(target)
      gl.render(scene, camera)
      const stats = drawStats(gl)
      gl.setRenderTarget(previous)
      gl.info.autoReset = autoReset
      target.dispose()
      return stats
    }

    window.__renderInfo = (): RenderInfoSnapshot => {
      const { gl, scene, size, viewport } = get()
      const sceneStats = measureScene()
      return {
        frame: last.current,
        scene: sceneStats,
        post: subtractStats(last.current, sceneStats),
        programs: gl.info.programs?.length ?? 0,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
        passes: devComposerPasses(),
        dpr: viewport.dpr,
        size: { width: size.width, height: size.height },
        materials: summarizeMaterials(scene, findRoom(scene)),
        quality: useStore.getState().quality,
      }
    }
    ;(window as unknown as { __tmpScene: unknown; __tmpGet: unknown }).__tmpScene = get().scene
    ;(window as unknown as { __tmpGet: unknown }).__tmpGet = get
    ;(window as unknown as { __tmpRT: unknown }).__tmpRT = WebGLRenderTarget
    window.__screenPoint = (name) => {
      const { scene, camera, size } = get()
      const box = boxOfNodes(scene, [name])
      if (box.isEmpty()) return null
      const ndc = box.getCenter(new Vector3()).project(camera)
      if (ndc.z > 1) return null
      return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height }
    }
    return () => {
      delete window.__renderInfo
      delete window.__screenPoint
    }
  }, [get])

  return null
}
