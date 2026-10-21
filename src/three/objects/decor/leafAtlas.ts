import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { random } from '../tapes/labelAtlas'
import { LEAF_SHAPE, LEAF_SHAPES } from './plants'

/**
 * The leaf shapes (one 256² column each, alpha-tested): a split monstera
 * leaf, a variegated pothos heart and a banded snake-plant blade with yellow
 * margins. Drawn once (deterministic); the leaf's base is at the bottom of
 * its cell (CanvasTexture flipY: uv.y 0 = base).
 */

export const LEAF_CELL = 256

function monsteraLeaf(g: CanvasRenderingContext2D, s: number): void {
  const rand = random(0x4d4f4e)
  const leaf = new Path2D()
  leaf.moveTo(s * 0.5, s * 0.98)
  leaf.bezierCurveTo(s * 0.02, s * 0.85, s * 0.0, s * 0.3, s * 0.42, s * 0.05)
  leaf.quadraticCurveTo(s * 0.5, s * 0.0, s * 0.58, s * 0.05)
  leaf.bezierCurveTo(s * 1.0, s * 0.3, s * 0.98, s * 0.85, s * 0.5, s * 0.98)
  const fill = g.createLinearGradient(0, 0, s, s)
  fill.addColorStop(0, '#2f6b35')
  fill.addColorStop(1, '#1d4a26')
  g.fillStyle = fill
  g.fill(leaf)
  // Splits from the edge toward the midrib, and a row of holes.
  g.save()
  g.globalCompositeOperation = 'destination-out'
  g.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    const y = s * (0.18 + i * 0.1)
    for (const side of [-1, 1]) {
      g.lineWidth = s * (0.025 + rand() * 0.012)
      g.beginPath()
      g.moveTo(s * 0.5 + side * s * (0.12 + rand() * 0.04), y + s * 0.02)
      g.lineTo(s * 0.5 + side * s * 0.55, y - s * 0.06)
      g.stroke()
    }
  }
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      g.beginPath()
      g.ellipse(s * 0.5 + side * s * 0.09, s * (0.3 + i * 0.14), s * 0.018, s * 0.03, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  g.restore()
  g.strokeStyle = 'rgba(190, 220, 150, 0.55)'
  g.lineWidth = s * 0.014
  g.beginPath()
  g.moveTo(s * 0.5, s * 0.98)
  g.quadraticCurveTo(s * 0.52, s * 0.5, s * 0.5, s * 0.08)
  g.stroke()
}

function pothosLeaf(g: CanvasRenderingContext2D, s: number): void {
  const rand = random(0x706f74)
  const leaf = new Path2D()
  leaf.moveTo(s * 0.5, s * 0.82)
  leaf.bezierCurveTo(s * 0.25, s * 0.98, s * 0.02, s * 0.75, s * 0.12, s * 0.48)
  leaf.bezierCurveTo(s * 0.2, s * 0.25, s * 0.42, s * 0.12, s * 0.5, s * 0.02)
  leaf.bezierCurveTo(s * 0.58, s * 0.12, s * 0.8, s * 0.25, s * 0.88, s * 0.48)
  leaf.bezierCurveTo(s * 0.98, s * 0.75, s * 0.75, s * 0.98, s * 0.5, s * 0.82)
  g.fillStyle = '#3f8a3a'
  g.fill(leaf)
  g.save()
  g.clip(leaf)
  // Golden variegation streaks along the veins.
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(226, 214, 120, ${(0.35 + rand() * 0.35).toFixed(2)})`
    g.lineWidth = s * (0.012 + rand() * 0.03)
    g.beginPath()
    const side = rand() < 0.5 ? -1 : 1
    g.moveTo(s * 0.5, s * (0.3 + rand() * 0.45))
    g.quadraticCurveTo(s * (0.5 + side * 0.18), s * (0.3 + rand() * 0.3), s * (0.5 + side * (0.3 + rand() * 0.15)), s * (0.15 + rand() * 0.5))
    g.stroke()
  }
  g.restore()
  g.strokeStyle = 'rgba(200, 230, 150, 0.5)'
  g.lineWidth = s * 0.012
  g.beginPath()
  g.moveTo(s * 0.5, s * 0.82)
  g.lineTo(s * 0.5, s * 0.06)
  g.stroke()
}

function snakeBlade(g: CanvasRenderingContext2D, s: number): void {
  const blade = new Path2D()
  blade.moveTo(s * 0.18, s)
  blade.bezierCurveTo(s * 0.08, s * 0.6, s * 0.2, s * 0.2, s * 0.5, s * 0.0)
  blade.bezierCurveTo(s * 0.8, s * 0.2, s * 0.92, s * 0.6, s * 0.82, s)
  blade.closePath()
  g.fillStyle = '#c9b84a'
  g.fill(blade)
  g.save()
  g.clip(blade)
  g.fillStyle = '#24502f'
  g.beginPath()
  g.moveTo(s * 0.3, s)
  g.bezierCurveTo(s * 0.22, s * 0.6, s * 0.3, s * 0.25, s * 0.5, s * 0.07)
  g.bezierCurveTo(s * 0.7, s * 0.25, s * 0.78, s * 0.6, s * 0.7, s)
  g.fill()
  // Pale wavy cross bands.
  g.strokeStyle = 'rgba(160, 196, 140, 0.4)'
  g.lineWidth = s * 0.02
  for (let y = s * 0.12; y < s; y += s * 0.07) {
    g.beginPath()
    g.moveTo(0, y)
    g.bezierCurveTo(s * 0.3, y - s * 0.03, s * 0.6, y + s * 0.03, s, y)
    g.stroke()
  }
  g.restore()
}

/** The atlas texture (sRGB, mipmapped). */
export function createLeafAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = LEAF_CELL * LEAF_SHAPES
  canvas.height = LEAF_CELL
  const g = canvas.getContext('2d')
  if (g) {
    const draw: Record<number, (g: CanvasRenderingContext2D, s: number) => void> = {
      [LEAF_SHAPE.monstera]: monsteraLeaf,
      [LEAF_SHAPE.pothos]: pothosLeaf,
      [LEAF_SHAPE.blade]: snakeBlade,
    }
    for (let shape = 0; shape < LEAF_SHAPES; shape++) {
      g.save()
      g.translate(shape * LEAF_CELL, 0)
      g.beginPath()
      g.rect(0, 0, LEAF_CELL, LEAF_CELL)
      g.clip()
      draw[shape]?.(g, LEAF_CELL)
      g.restore()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.name = 'leaves'
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  return texture
}
