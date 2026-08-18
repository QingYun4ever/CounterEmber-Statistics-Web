import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Skin renders, proxied and cached on the server.
 *
 * Hotlinking a skin service from the browser would mean every visitor hits a third party on
 * every page — slow, and unreliable from mainland China. Instead the server fetches once and
 * caches the PNG on disk.
 *
 * The target server runs in offline mode, so plenty of names have no Mojang account behind them.
 * Upstreams answer those with the default Steve/Alex skin, which is fine; if every upstream
 * fails we still return a deterministic monogram so the page never shows a broken image.
 */

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 6000

type Kind = 'head' | 'body'

const UPSTREAMS: Record<Kind, (name: string, size: number) => string[]> = {
  head: (name, size) => [
    `https://mc-heads.net/avatar/${name}/${size}`,
    `https://minotar.net/avatar/${name}/${size}`,
  ],
  body: (name, size) => [
    `https://mc-heads.net/body/${name}/${size}`,
    `https://minotar.net/armor/body/${name}/${size}`,
  ],
}

const SIZE_LIMITS: Record<Kind, { min: number; max: number; fallback: number }> = {
  head: { min: 16, max: 256, fallback: 64 },
  body: { min: 64, max: 512, fallback: 256 },
}

function cacheDir(): string {
  return process.env.CESTATS_SKIN_CACHE ?? path.join(process.cwd(), 'data', 'skins')
}

/** Stable hue per name, so a player's placeholder colour never changes between visits. */
function hueOf(name: string): number {
  const digest = createHash('sha256').update(name.toLowerCase()).digest()
  return digest[0] * 360 / 256
}

function monogram(name: string, kind: Kind): Response {
  const hue = hueOf(name)
  const a = `hsl(${hue} 78% 72%)`
  const b = `hsl(${(hue + 42) % 360} 74% 62%)`
  const letters = name.slice(0, 2).toUpperCase()
  const [w, h] = kind === 'head' ? [64, 64] : [80, 160]

  const svg =
    kind === 'head'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <text x="32" y="41" font-family="Inter,system-ui,sans-serif" font-size="25" font-weight="600"
        fill="#fff" fill-opacity=".92" text-anchor="middle">${letters}</text>
</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 160" width="${w}" height="${h}">
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
      // Short cache: the upstream may just be having a bad minute.
      'cache-control': 'public, max-age=300',
    },
  })
}

async function fetchUpstream(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'cestats/0.1 (+self-hosted stats site)' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
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
  const kind = rawKind === 'body' ? 'body' : 'head'
  const name = decodeURIComponent(rawName)

  if (!NAME_RE.test(name)) return monogram(name || '?', kind)

  const limits = SIZE_LIMITS[kind]
  const requested = Number(new URL(request.url).searchParams.get('s'))
  const size = Number.isFinite(requested)
    ? Math.min(limits.max, Math.max(limits.min, Math.round(requested)))
    : limits.fallback

  const file = path.join(cacheDir(), `${kind}-${size}-${name.toLowerCase()}.png`)

  try {
    const stat = await fs.stat(file)
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      return png(await fs.readFile(file))
    }
  } catch {
    // not cached yet
  }

  for (const url of UPSTREAMS[kind](name, size)) {
    const buf = await fetchUpstream(url)
    if (!buf) continue
    try {
      await fs.mkdir(cacheDir(), { recursive: true })
      await fs.writeFile(file, buf)
    } catch {
      // Serving the image matters more than caching it.
    }
    return png(buf)
  }

  // Every upstream failed. If we have a stale copy, a stale skin beats a placeholder.
  try {
    return png(await fs.readFile(file))
  } catch {
    return monogram(name, kind)
  }
}
