import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { renderBody, renderHead } from '@/lib/skin-render'
import { STEVE_TEXTURE } from '@/lib/steve-texture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Skin renders, produced on the server.
 *
 * Finding a player's texture takes three tries, because this server runs in offline mode and its
 * population is mixed:
 *
 *   1. Mojang knows the name  -> use their premium skin. `api.mojang.com` answering 404 is the
 *      cheapest possible "is this a premium account" check, and it also hands back the UUID that
 *      every downstream Mojang-side service wants.
 *   2. Otherwise LittleSkin   -> where the offline players' skins actually live. Its CSL endpoint
 *      404s on unknown names, so asking is safe.
 *   3. Otherwise Steve        -> "this player never set a skin" is the honest reading, and it is
 *      what every Minecraft client shows for them anyway.
 *
 * Rendering is local (see lib/skin-render): no render service can be handed a LittleSkin texture,
 * so doing it here is the only way all three groups come out in one visual style.
 */

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/
const FETCH_TIMEOUT_MS = 8000

/** Renders are keyed by texture content, so they can never go stale — only unused. */
const RENDER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TEXTURE_TTL_MS = 24 * 60 * 60 * 1000
/** Shorter, so a player who sets a skin stops being Steve the same day. */
const DEFAULT_TEXTURE_TTL_MS = 6 * 60 * 60 * 1000

type Kind = 'head' | 'body'
type Source = 'mojang' | 'littleskin' | 'default'

const SIZE_LIMITS: Record<Kind, { min: number; max: number; fallback: number }> = {
  head: { min: 16, max: 256, fallback: 64 },
  body: { min: 64, max: 512, fallback: 256 },
}

interface Skin {
  png: Buffer
  slim: boolean
  source: Source
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

/** 200 with a UUID means premium; 404 means the name belongs to nobody on Mojang's side. */
async function mojangUuid(name: string): Promise<string | null> {
  const profile = (await get(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    'json',
  )) as { id?: string } | null
  return typeof profile?.id === 'string' && profile.id.length === 32 ? profile.id : null
}

interface SessionTexture {
  url: string
  slim: boolean
}

/**
 * The session server is the only place that says whether a premium skin uses the slim (3px) arm
 * model, so it is worth the extra call — guessing from the texture's alpha channel is unreliable
 * (plenty of slim skins have the unused arm column filled in).
 */
async function mojangTexture(uuid: string): Promise<SessionTexture | null> {
  const profile = (await get(
    `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
    'json',
  )) as { properties?: { name: string; value: string }[] } | null

  const encoded = profile?.properties?.find((p) => p.name === 'textures')?.value
  if (!encoded) return null

  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url?: string; metadata?: { model?: string } } }
    }
    const skin = decoded.textures?.SKIN
    if (!skin?.url) return null
    return { url: skin.url, slim: skin.metadata?.model === 'slim' }
  } catch {
    return null
  }
}

async function fromMojang(name: string): Promise<Skin | null> {
  const uuid = await mojangUuid(name)
  if (!uuid) return null

  const texture = await mojangTexture(uuid)
  if (texture) {
    // textures.minecraft.net is plain http and not always reachable; fall through if it fails.
    const png = await get(texture.url.replace(/^http:/, 'https:'), 'buffer')
    if (png) return { png, slim: texture.slim, source: 'mojang' }
  }

  // A renderer's raw-texture endpoint, used purely as a mirror. It cannot tell us the arm model,
  // so a slim-armed premium player renders with classic arms on this path only.
  const mirrored = await get(`https://skins.mcstats.com/raw/${uuid}?autoUpgrade=true`, 'buffer')
  if (mirrored) return { png: mirrored, slim: texture?.slim ?? false, source: 'mojang' }

  return null
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
  return { png, slim: !skins.default && Boolean(skins.slim), source: 'littleskin' }
}

const STEVE: Skin = { png: STEVE_TEXTURE, slim: false, source: 'default' }

interface CachedMeta {
  slim?: boolean
  source?: Source
}

/** Raw textures are cached separately so head and body do not each hit the network. */
async function loadSkin(name: string): Promise<Skin> {
  const dir = cacheDir()
  const key = name.toLowerCase()
  const pngFile = path.join(dir, `texture-${key}.png`)
  const metaFile = path.join(dir, `texture-${key}.json`)

  const readCached = async (): Promise<{ skin: Skin; age: number } | null> => {
    try {
      const stat = await fs.stat(pngFile)
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as CachedMeta
      return {
        skin: {
          png: await fs.readFile(pngFile),
          slim: Boolean(meta.slim),
          source: meta.source ?? 'littleskin',
        },
        age: Date.now() - stat.mtimeMs,
      }
    } catch {
      return null
    }
  }

  const cached = await readCached()
  if (cached) {
    const ttl = cached.skin.source === 'default' ? DEFAULT_TEXTURE_TTL_MS : TEXTURE_TTL_MS
    if (cached.age < ttl) return cached.skin
  }

  const fetched = (await fromMojang(name)) ?? (await fromLittleSkin(name))
  if (fetched) {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(pngFile, fetched.png)
      await fs.writeFile(metaFile, JSON.stringify({ slim: fetched.slim, source: fetched.source }))
    } catch {
      // Serving matters more than caching.
    }
    return fetched
  }

  // Both upstreams are unreachable rather than empty: an expired real skin beats a default one.
  if (cached && cached.skin.source !== 'default') return cached.skin

  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(pngFile, STEVE.png)
    await fs.writeFile(metaFile, JSON.stringify({ slim: false, source: 'default' }))
  } catch {
    // Serving matters more than caching.
  }
  return STEVE
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

  const limits = SIZE_LIMITS[kind]
  const requested = Number(new URL(request.url).searchParams.get('s'))
  const size = Number.isFinite(requested)
    ? Math.min(limits.max, Math.max(limits.min, Math.round(requested)))
    : limits.fallback

  // A name that cannot be a Minecraft name is never worth a network round trip.
  const skin = NAME_RE.test(name) ? await loadSkin(name) : STEVE

  // Keyed by texture content, not by player: two players sharing a skin share the render, and a
  // player who changes skin gets a new key instead of a stale hit.
  const digest = createHash('sha1').update(skin.png).digest('hex').slice(0, 16)
  const rendered = path.join(cacheDir(), `${kind}-${size}-${skin.slim ? 'slim' : 'wide'}-${digest}.png`)

  try {
    const stat = await fs.stat(rendered)
    if (Date.now() - stat.mtimeMs < RENDER_TTL_MS) {
      return png(await fs.readFile(rendered))
    }
  } catch {
    // not rendered yet
  }

  let out: Buffer
  try {
    out = kind === 'head' ? renderHead(skin.png, size) : renderBody(skin.png, size, skin.slim)
  } catch {
    // Corrupt or unexpected texture format — better a default body than a broken image.
    out = kind === 'head' ? renderHead(STEVE.png, size) : renderBody(STEVE.png, size, false)
  }

  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(rendered, out)
  } catch {
    // Serving matters more than caching.
  }
  return png(out)
}
