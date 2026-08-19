import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { renderBody, renderHead } from '@/lib/skin-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Skin renders, produced on the server.
 *
 * The target server runs in offline mode and its players' skins live on LittleSkin, which the
 * usual renderers (Crafatar, Visage, mc-heads) know nothing about — they would all answer with
 * a default Steve. So we fetch the raw texture instead and draw the head/body ourselves.
 *
 * Order: LittleSkin first (it 404s on unknown names, so this is safe), then the Mojang-backed
 * skin mirrors, then a deterministic monogram so a page never shows a broken image.
 */

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/
const RENDER_TTL_MS = 7 * 24 * 60 * 60 * 1000
const TEXTURE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

type Kind = 'head' | 'body'

const SIZE_LIMITS: Record<Kind, { min: number; max: number; fallback: number }> = {
  head: { min: 16, max: 256, fallback: 64 },
  body: { min: 64, max: 512, fallback: 256 },
}

interface Skin {
  png: Buffer
  slim: boolean
}

function cacheDir(): string {
  return process.env.CESTATS_SKIN_CACHE ?? path.join(process.cwd(), 'data', 'skins')
}

async function get(url: string, as: 'json'): Promise<unknown | null>
async function get(url: string, as: 'buffer'): Promise<Buffer | null>
async function get(url: string, as: 'json' | 'buffer'): Promise<unknown> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'cestats/0.1 (+self-hosted stats site)' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    if (as === 'json') return await res.json()
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

/** LittleSkin's CustomSkinLoader endpoint hands us the texture hash and the model type. */
async function fromLittleSkin(name: string): Promise<Skin | null> {
  const meta = (await get(`https://littleskin.cn/csl/${encodeURIComponent(name)}.json`, 'json')) as
    | { skins?: { default?: string; slim?: string } }
    | null
  const skins = meta?.skins
  if (!skins) return null

  const hash = skins.default ?? skins.slim
  if (!hash) return null

  const png = await get(`https://littleskin.cn/textures/${hash}`, 'buffer')
  if (!png) return null
  return { png, slim: !skins.default && Boolean(skins.slim) }
}

async function fromMojangMirrors(name: string): Promise<Skin | null> {
  for (const url of [
    `https://minotar.net/skin/${encodeURIComponent(name)}`,
    `https://mc-heads.net/skin/${encodeURIComponent(name)}`,
  ]) {
    const png = await get(url, 'buffer')
    if (png) return { png, slim: false }
  }
  return null
}

/** Raw textures are cached separately so head and body do not each hit the network. */
async function loadSkin(name: string): Promise<Skin | null> {
  const dir = cacheDir()
  const pngFile = path.join(dir, `texture-${name.toLowerCase()}.png`)
  const metaFile = path.join(dir, `texture-${name.toLowerCase()}.json`)

  try {
    const stat = await fs.stat(pngFile)
    if (Date.now() - stat.mtimeMs < TEXTURE_TTL_MS) {
      const png = await fs.readFile(pngFile)
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as { slim?: boolean }
      return { png, slim: Boolean(meta.slim) }
    }
  } catch {
    // not cached yet
  }

  const skin = (await fromLittleSkin(name)) ?? (await fromMojangMirrors(name))
  if (skin) {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(pngFile, skin.png)
      await fs.writeFile(metaFile, JSON.stringify({ slim: skin.slim }))
    } catch {
      // Serving matters more than caching.
    }
    return skin
  }

  // Everything is down: a stale texture still beats a placeholder.
  try {
    const png = await fs.readFile(pngFile)
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as { slim?: boolean }
    return { png, slim: Boolean(meta.slim) }
  } catch {
    return null
  }
}

/** Stable hue per name, so a player's placeholder colour never changes between visits. */
function monogram(name: string, kind: Kind): Response {
  const hue = (createHash('sha256').update(name.toLowerCase()).digest()[0] * 360) / 256
  const a = `hsl(${hue} 78% 72%)`
  const b = `hsl(${(hue + 42) % 360} 74% 62%)`
  const letters = (name.slice(0, 2) || '?').toUpperCase()

  const svg =
    kind === 'head'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <text x="32" y="41" font-family="Inter,system-ui,sans-serif" font-size="25" font-weight="600"
        fill="#fff" fill-opacity=".92" text-anchor="middle">${letters}</text>
</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 160" width="80" height="160">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect x="22" y="6"  width="36" height="36" rx="9"  fill="url(#g)"/>
  <rect x="16" y="48" width="48" height="60" rx="11" fill="url(#g)" fill-opacity=".82"/>
  <rect x="24" y="114" width="14" height="40" rx="6" fill="url(#g)" fill-opacity=".66"/>
  <rect x="42" y="114" width="14" height="40" rx="6" fill="url(#g)" fill-opacity=".66"/>
  <text x="40" y="31" font-family="Inter,system-ui,sans-serif" font-size="17" font-weight="600"
        fill="#fff" fill-opacity=".95" text-anchor="middle">${letters}</text>
</svg>`

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}

function png(body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; name: string }> },
) {
  const { kind: rawKind, name: rawName } = await params
  const kind: Kind = rawKind === 'body' ? 'body' : 'head'
  const name = decodeURIComponent(rawName)

  if (!NAME_RE.test(name)) return monogram(name, kind)

  const limits = SIZE_LIMITS[kind]
  const requested = Number(new URL(request.url).searchParams.get('s'))
  const size = Number.isFinite(requested)
    ? Math.min(limits.max, Math.max(limits.min, Math.round(requested)))
    : limits.fallback

  const rendered = path.join(cacheDir(), `${kind}-${size}-${name.toLowerCase()}.png`)
  try {
    const stat = await fs.stat(rendered)
    if (Date.now() - stat.mtimeMs < RENDER_TTL_MS) {
      return png(await fs.readFile(rendered))
    }
  } catch {
    // not rendered yet
  }

  const skin = await loadSkin(name)
  if (!skin) return monogram(name, kind)

  let out: Buffer
  try {
    out = kind === 'head' ? renderHead(skin.png, size) : renderBody(skin.png, size, skin.slim)
  } catch {
    // Corrupt or unexpected texture format.
    return monogram(name, kind)
  }

  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(rendered, out)
  } catch {
    // Serving matters more than caching.
  }
  return png(out)
}
