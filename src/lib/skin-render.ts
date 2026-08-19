import { PNG } from 'pngjs'

/**
 * Renders Minecraft skin textures into head and body images.
 *
 * Done locally rather than through a render service because the target server is offline mode:
 * its players' skins live on LittleSkin, and the usual renderers (Crafatar, Visage, mc-heads)
 * only know Mojang accounts. Once we have the raw 64×64 texture, drawing a front view is just
 * compositing a handful of rectangles — cheaper and more reliable than another network hop.
 *
 * Pure JS (pngjs), so there is no native module to build in the Docker image.
 */

interface Canvas {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Buffer
}

function canvas(width: number, height: number): Canvas {
  return { width, height, data: Buffer.alloc(width * height * 4) }
}

/**
 * Copies a rectangle out of the skin onto the canvas, alpha-blending so overlay layers
 * (hat, jacket, sleeves) can be drawn on top of the base layer.
 */
function blit(
  dst: Canvas,
  src: Canvas,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  mirror = false,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcX = mirror ? sx + w - 1 - x : sx + x
      const srcY = sy + y
      if (srcX < 0 || srcY < 0 || srcX >= src.width || srcY >= src.height) continue

      const s = (srcY * src.width + srcX) * 4
      const alpha = src.data[s + 3]
      if (alpha === 0) continue

      const tx = dx + x
      const ty = dy + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const d = (ty * dst.width + tx) * 4

      if (alpha === 255) {
        src.data.copy(dst.data, d, s, s + 4)
        continue
      }
      const a = alpha / 255
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round(src.data[s + c] * a + dst.data[d + c] * (1 - a))
      }
      dst.data[d + 3] = Math.max(dst.data[d + 3], alpha)
    }
  }
}

/** Nearest-neighbour integer upscale — the whole point is to keep the pixels sharp. */
function scale(src: Canvas, factor: number): Canvas {
  if (factor <= 1) return src
  const out = canvas(src.width * factor, src.height * factor)
  for (let y = 0; y < out.height; y++) {
    const sy = (y / factor) | 0
    for (let x = 0; x < out.width; x++) {
      const sx = (x / factor) | 0
      src.data.copy(out.data, (y * out.width + x) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4)
    }
  }
  return out
}

function encode(c: Canvas): Buffer {
  const png = new PNG({ width: c.width, height: c.height })
  c.data.copy(png.data)
  return PNG.sync.write(png)
}

function decode(buffer: Buffer): Canvas {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

/** Face plus the hat layer. */
export function renderHead(skinPng: Buffer, targetSize: number): Buffer {
  const skin = decode(skinPng)
  const face = canvas(8, 8)
  blit(face, skin, 8, 8, 8, 8, 0, 0)
  blit(face, skin, 40, 8, 8, 8, 0, 0) // hat overlay
  return encode(scale(face, Math.max(1, Math.floor(targetSize / 8))))
}

/**
 * Front-facing full body, 16×32 at 1×.
 *
 * Legacy 64×32 skins have no dedicated left arm/leg, so those are mirrored from the right —
 * which is exactly what the game does.
 */
export function renderBody(skinPng: Buffer, targetHeight: number, slim: boolean): Buffer {
  const skin = decode(skinPng)
  const legacy = skin.height < 64
  const armW = slim ? 3 : 4
  const body = canvas(16, 32)

  // Torso
  blit(body, skin, 20, 20, 8, 12, 4, 8)
  // Right arm (viewer's left)
  blit(body, skin, 44, 20, armW, 12, 4 - armW, 8)
  // Left arm
  if (legacy) blit(body, skin, 44, 20, armW, 12, 12, 8, true)
  else blit(body, skin, 36, 52, armW, 12, 12, 8)
  // Right leg
  blit(body, skin, 4, 20, 4, 12, 4, 20)
  // Left leg
  if (legacy) blit(body, skin, 4, 20, 4, 12, 8, 20, true)
  else blit(body, skin, 20, 52, 4, 12, 8, 20)
  // Head
  blit(body, skin, 8, 8, 8, 8, 4, 0)

  // Overlay layers on top, in the same order.
  if (!legacy) {
    blit(body, skin, 20, 36, 8, 12, 4, 8) // jacket
    blit(body, skin, 44, 36, armW, 12, 4 - armW, 8) // right sleeve
    blit(body, skin, 52, 52, armW, 12, 12, 8) // left sleeve
    blit(body, skin, 4, 36, 4, 12, 4, 20) // right trouser
    blit(body, skin, 4, 52, 4, 12, 8, 20) // left trouser
  }
  blit(body, skin, 40, 8, 8, 8, 4, 0) // hat

  return encode(scale(body, Math.max(1, Math.floor(targetHeight / 32))))
}
