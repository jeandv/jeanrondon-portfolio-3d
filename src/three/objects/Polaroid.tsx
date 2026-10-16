import { useEffect, useMemo } from 'react'
import { CanvasTexture, type Object3D } from 'three'
import { PROFILE } from '../../content/profile'
import { configureScreenTexture } from '../../screens/CanvasScreen'
import { useScreenFonts } from '../../screens/fonts'
import { drawPolaroid, pickPhotoUrl, POLAROID_SIZE } from '../../screens/polaroid'
import { createLitSurfaceMaterial } from '../materials/litSurface'
import { findMesh, swapMaterial } from './screenRuntime'
import { useDisposable } from './useScreen'

// A portrait at src/assets/photo.{jpg,jpeg,png,webp} (that priority) replaces
// the initials placeholder, cover-cropped into the square; the glob keeps it optional.
const PHOTO_FILES = import.meta.glob<string>('../../assets/photo.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const PHOTO_URL: string | undefined = pickPhotoUrl(PHOTO_FILES)

function createPolaroidTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = POLAROID_SIZE.width
  canvas.height = POLAROID_SIZE.height
  return configureScreenTexture(new CanvasTexture(canvas), 'polaroid')
}

function paint(texture: CanvasTexture, photo?: HTMLImageElement): void {
  const g = texture.image.getContext('2d')
  if (!g) return
  drawPolaroid(g, PROFILE, photo)
  texture.needsUpdate = true
}

/** Loads the optional photo; returns a cancel function. */
function loadPhoto(url: string, onLoad: (image: HTMLImageElement) => void): () => void {
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => onLoad(image)
  image.src = url
  return () => {
    image.onload = null
  }
}

export interface PolaroidProps {
  readonly room: Object3D
}

/** Polaroid by the PC: placeholder portrait (initials on a warm gradient) or the real photo. */
export function Polaroid({ room }: PolaroidProps) {
  useScreenFonts()
  const mesh = useMemo(() => findMesh(room, 'polaroid_photo'), [room])
  const texture = useMemo(() => createPolaroidTexture(), [])
  const material = useMemo(
    () => createLitSurfaceMaterial(texture, { name: 'M_polaroid', glow: 0.14, roughness: 0.55 }),
    [texture],
  )
  useDisposable(texture)
  useDisposable(material)

  useEffect(() => {
    paint(texture)
    return PHOTO_URL ? loadPhoto(PHOTO_URL, (image) => paint(texture, image)) : undefined
  }, [texture])
  useEffect(() => (mesh ? swapMaterial(mesh, material) : undefined), [mesh, material])
  return null
}
