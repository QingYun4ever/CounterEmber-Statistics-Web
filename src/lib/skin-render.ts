import { PNG } from 'pngjs'

/**
 * Renders Minecraft skin textures into head and body images.
 *
 * Done locally rather than through a render service because the target server is offline mode:
 * most of its players' skins live on LittleSkin, and every render service worth using
 * (mc-heads, Crafatar, Visage, skins.mcstats.com) resolves players through Mojang and cannot be
 * handed a third-party texture. Rendering here means premium players, LittleSkin players and
 * skinless players all come out in one visual style instead of two or three.
 *
 * The head is a flat face — that is what a 28px avatar in a table wants. The body is a real 3D
 * render: a small software rasteriser over the ~72 quads of the player model, in the spirit of
 * NickAcPT/nmsr-rs but without its precomputed UV maps, since a fixed camera makes the direct
 * approach cheap enough.
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

// ---------------------------------------------------------------------------
// 3D body
// ---------------------------------------------------------------------------

/**
 * Legacy 64x32 skins have no left arm or leg in the texture; the game mirrors the right ones.
 * Rather than special-case the geometry, widen the texture to 64x64 first and let the renderer
 * see one layout. Each face is mirrored *and* the two side faces swap places, which is what
 * makes a mirrored limb look right instead of inside-out.
 */
function upgradeLegacy(skin: Canvas): Canvas {
  if (skin.height >= 64) return skin

  const out = canvas(64, 64)
  blit(out, skin, 0, 0, 64, 32, 0, 0)

  // [srcX, srcY, w, h, dstX, dstY] — right limb face -> mirrored left limb face.
  const moves: [number, number, number, number, number, number][] = [
    // Right leg -> left leg
    [8, 20, 4, 12, 16, 52], // left face  -> right face
    [4, 20, 4, 12, 20, 52], // front
    [0, 20, 4, 12, 24, 52], // right face -> left face
    [12, 20, 4, 12, 28, 52], // back
    [4, 16, 4, 4, 20, 48], // top
    [8, 16, 4, 4, 24, 48], // bottom
    // Right arm -> left arm
    [48, 20, 4, 12, 32, 52],
    [44, 20, 4, 12, 36, 52],
    [40, 20, 4, 12, 40, 52],
    [52, 20, 4, 12, 44, 52],
    [44, 16, 4, 4, 36, 48],
    [48, 16, 4, 4, 40, 48],
  ]
  for (const [sx, sy, w, h, dx, dy] of moves) {
    blit(out, skin, sx, sy, w, h, dx, dy, true)
  }
  return out
}

type Vec3 = [number, number, number]

interface Quad {
  /** Corners matching texture coords (u0,v0), (u1,v0), (u1,v1), (u0,v1). */
  corners: [Vec3, Vec3, Vec3, Vec3]
  u0: number
  v0: number
  u1: number
  v1: number
  /** Flat per-face lighting, the way the game fakes it: top bright, sides dim. */
  shade: number
}

const SHADE = { top: 1.0, bottom: 0.5, front: 0.87, back: 0.72, side: 0.65 }

/**
 * The six faces of one box, unwrapped the way Minecraft lays a cuboid out in a skin:
 * top and bottom on the upper strip, then right/front/left/back running left to right below.
 *
 * `inflate` grows the geometry without touching the UVs, which is how the overlay layers sit
 * just outside the base layer instead of z-fighting with it.
 */
function boxQuads(
  pos: Vec3,
  size: Vec3,
  uv: [number, number],
  inflate = 0,
): Quad[] {
  const [px, py, pz] = pos
  const [w, h, d] = size
  const [ux, uy] = uv

  const x0 = px - inflate
  const x1 = px + w + inflate
  const y0 = py - inflate
  const y1 = py + h + inflate
  const z0 = pz - inflate
  const z1 = pz + d + inflate

  return [
    {
      corners: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
      u0: ux + d, v0: uy, u1: ux + d + w, v1: uy + d, shade: SHADE.top,
    },
    {
      corners: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
      u0: ux + d + w, v0: uy, u1: ux + d + w + w, v1: uy + d, shade: SHADE.bottom,
    },
    {
      corners: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
      u0: ux, v0: uy + d, u1: ux + d, v1: uy + d + h, shade: SHADE.side,
    },
    {
      corners: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
      u0: ux + d, v0: uy + d, u1: ux + d + w, v1: uy + d + h, shade: SHADE.front,
    },
    {
      corners: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
      u0: ux + d + w, v0: uy + d, u1: ux + d + w + d, v1: uy + d + h, shade: SHADE.side,
    },
    {
      corners: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
      u0: ux + d + w + d, v0: uy + d, u1: ux + d + w + d + w, v1: uy + d + h, shade: SHADE.back,
    },
  ]
}

/**
 * The player model in texture units, feet at y=0, facing +z.
 * Returns the opaque base layer and the translucent overlay layer separately: they need
 * different rasteriser passes.
 */
function playerModel(slim: boolean): { base: Quad[]; overlay: Quad[] } {
  const aw = slim ? 3 : 4 // arm width
  const HAT = 0.5
  const LAYER = 0.25

  const base = [
    ...boxQuads([-4, 24, -4], [8, 8, 8], [0, 0]), // head
    ...boxQuads([-4, 12, -2], [8, 12, 4], [16, 16]), // torso
    ...boxQuads([-4 - aw, 12, -2], [aw, 12, 4], [40, 16]), // right arm
    ...boxQuads([4, 12, -2], [aw, 12, 4], [32, 48]), // left arm
    ...boxQuads([-4, 0, -2], [4, 12, 4], [0, 16]), // right leg
    ...boxQuads([0, 0, -2], [4, 12, 4], [16, 48]), // left leg
  ]

  const overlay = [
    ...boxQuads([-4, 24, -4], [8, 8, 8], [32, 0], HAT),
    ...boxQuads([-4, 12, -2], [8, 12, 4], [16, 32], LAYER),
    ...boxQuads([-4 - aw, 12, -2], [aw, 12, 4], [40, 32], LAYER),
    ...boxQuads([4, 12, -2], [aw, 12, 4], [48, 48], LAYER),
    ...boxQuads([-4, 0, -2], [4, 12, 4], [0, 32], LAYER),
    ...boxQuads([0, 0, -2], [4, 12, 4], [0, 48], LAYER),
  ]

  return { base, overlay }
}

/** Camera. Tuned by eye against a skins.mcstats.com render of the same skin. */
const YAW = (22 * Math.PI) / 180
const PITCH = (9 * Math.PI) / 180
/** Distance from the model centre, in texture units. Smaller = stronger perspective. */
const CAMERA_DISTANCE = 45
const MODEL_CENTRE_Y = 16
/** Rendered at this multiple and boxed down, which is all the antialiasing a silhouette needs. */
const SUPERSAMPLE = 2

interface Projected {
  x: number
  y: number
  /** 1/depth, for perspective-correct interpolation and depth testing. */
  w: number
}

function projector(): (p: Vec3) => Projected {
  const cy = Math.cos(YAW)
  const sy = Math.sin(YAW)
  const cp = Math.cos(PITCH)
  const sp = Math.sin(PITCH)

  return ([x, y, z]) => {
    const ty = y - MODEL_CENTRE_Y

    const rx = x * cy + z * sy
    const rz = -x * sy + z * cy

    const ry2 = ty * cp - rz * sp
    const rz2 = ty * sp + rz * cp

    const depth = CAMERA_DISTANCE - rz2
    const w = 1 / depth
    return { x: rx * w, y: -ry2 * w, w }
  }
}

interface Vertex {
  x: number
  y: number
  w: number
  /** u/depth and v/depth, so the interpolation stays perspective-correct. */
  uw: number
  vw: number
}

/**
 * Half-space triangle fill with a depth buffer.
 *
 * `blend` decides what happens to a texel that passes the depth test: the base layer writes
 * straight through, the overlay layer alpha-blends over whatever is already there.
 */
function triangle(
  target: Canvas,
  depth: Float64Array,
  v0: Vertex,
  v1: Vertex,
  v2: Vertex,
  skin: Canvas,
  quad: Quad,
  blend: boolean,
): void {
  const area = (v1.x - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (v1.y - v0.y)
  if (area === 0) return
  // Screen y points down, so a face we are looking at head-on winds clockwise: positive area.
  // Dropping the rest is not strictly needed with a depth buffer, but it halves the fill work
  // and keeps the overlay pass from blending a box's far side over its near side.
  if (area < 0) return

  const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)))
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)))
  const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)))
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)))
  if (minX > maxX || minY > maxY) return

  const inv = 1 / area

  for (let py = minY; py <= maxY; py++) {
    const y = py + 0.5
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5

      const w0 = ((v1.x - x) * (v2.y - y) - (v2.x - x) * (v1.y - y)) * inv
      const w1 = ((v2.x - x) * (v0.y - y) - (v0.x - x) * (v2.y - y)) * inv
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue

      const w = w0 * v0.w + w1 * v1.w + w2 * v2.w
      const idx = py * target.width + px
      if (w <= depth[idx]) continue

      const u = (w0 * v0.uw + w1 * v1.uw + w2 * v2.uw) / w
      const v = (w0 * v0.vw + w1 * v1.vw + w2 * v2.vw) / w

      // Nearest texel, clamped inside this face's rect so a seam never samples its neighbour.
      const tx = Math.min(quad.u1 - 1, Math.max(quad.u0, Math.floor(u)))
      const ty = Math.min(quad.v1 - 1, Math.max(quad.v0, Math.floor(v)))
      const s = (ty * skin.width + tx) * 4
      const alpha = skin.data[s + 3]
      if (alpha === 0) continue

      const d = idx * 4
      const r = skin.data[s] * quad.shade
      const g = skin.data[s + 1] * quad.shade
      const b = skin.data[s + 2] * quad.shade

      if (!blend || alpha === 255) {
        target.data[d] = r
        target.data[d + 1] = g
        target.data[d + 2] = b
        target.data[d + 3] = 255
        depth[idx] = w
        continue
      }

      const a = alpha / 255
      target.data[d] = Math.round(r * a + target.data[d] * (1 - a))
      target.data[d + 1] = Math.round(g * a + target.data[d + 1] * (1 - a))
      target.data[d + 2] = Math.round(b * a + target.data[d + 2] * (1 - a))
      target.data[d + 3] = Math.max(target.data[d + 3], alpha)
      depth[idx] = w
    }
  }
}

/** Box filter, undoing the supersample. */
function downsample(src: Canvas, factor: number): Canvas {
  if (factor <= 1) return src
  const out = canvas(Math.floor(src.width / factor), Math.floor(src.height / factor))
  const n = factor * factor

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const s = ((y * factor + sy) * src.width + (x * factor + sx)) * 4
          const alpha = src.data[s + 3]
          // Weight colour by coverage, or transparent pixels darken the silhouette edge.
          r += src.data[s] * alpha
          g += src.data[s + 1] * alpha
          b += src.data[s + 2] * alpha
          a += alpha
        }
      }
      const d = (y * out.width + x) * 4
      if (a > 0) {
        out.data[d] = Math.round(r / a)
        out.data[d + 1] = Math.round(g / a)
        out.data[d + 2] = Math.round(b / a)
      }
      out.data[d + 3] = Math.round(a / n)
    }
  }
  return out
}

/**
 * Front-facing 3D body render.
 *
 * `targetHeight` is the height of the returned PNG; the width follows from the projection, so
 * callers should lay this out with `width: auto`.
 */
export function renderBody(skinPng: Buffer, targetHeight: number, slim: boolean): Buffer {
  const skin = upgradeLegacy(decode(skinPng))
  const { base, overlay } = playerModel(slim)
  const project = projector()

  // Frame the model: project every corner, then fit that box to the requested height.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const quad of [...base, ...overlay]) {
    for (const corner of quad.corners) {
      const p = project(corner)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }

  const height = Math.max(32, Math.round(targetHeight)) * SUPERSAMPLE
  const unit = height / (maxY - minY)
  const width = Math.max(1, Math.round((maxX - minX) * unit))

  const target = canvas(width, height)
  const depth = new Float64Array(width * height).fill(-Infinity)

  const toScreen = (corner: Vec3, quad: Quad, u: number, v: number): Vertex => {
    const p = project(corner)
    return {
      x: (p.x - minX) * unit,
      y: (p.y - minY) * unit,
      w: p.w,
      uw: u * p.w,
      vw: v * p.w,
    }
  }

  const draw = (quads: Quad[], blend: boolean) => {
    for (const quad of quads) {
      const [c0, c1, c2, c3] = quad.corners
      const a = toScreen(c0, quad, quad.u0, quad.v0)
      const b = toScreen(c1, quad, quad.u1, quad.v0)
      const c = toScreen(c2, quad, quad.u1, quad.v1)
      const d = toScreen(c3, quad, quad.u0, quad.v1)
      triangle(target, depth, a, b, c, skin, quad, blend)
      triangle(target, depth, a, c, d, skin, quad, blend)
    }
  }

  draw(base, false)
  draw(overlay, true)

  return encode(downsample(target, SUPERSAMPLE))
}
