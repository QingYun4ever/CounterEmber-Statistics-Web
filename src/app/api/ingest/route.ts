import { NextResponse } from 'next/server'
import { saveMatch } from '@/lib/db'
import { authenticateDevice } from '@/lib/api-auth'
import { computeMatchId, zMatch } from '@/lib/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_INGEST_BODY_BYTES = 512 * 1024

export async function POST(req: Request) {
  if (process.env.CESTATS_INGEST_ENABLED === 'false') {
    return NextResponse.json({ ok: false, error: 'ingest_disabled' }, { status: 503 })
  }

  const device = authenticateDevice(req)
  if (!device) {
    return NextResponse.json({ ok: false, error: 'invalid device token' }, { status: 401 })
  }

  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 })
  }

  let body: unknown
  try {
    const raw = await req.arrayBuffer()
    if (raw.byteLength > MAX_INGEST_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 })
    }
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return NextResponse.json({ ok: false, error: 'body is not valid JSON' }, { status: 400 })
  }

  const parsed = zMatch.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid payload', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const match = parsed.data
  if (match.uploader !== device.player) {
    return NextResponse.json({ ok: false, error: 'uploader does not match paired player' }, { status: 403 })
  }

  // The id is always recomputed here: a buggy client must not be able to create duplicates.
  const result = saveMatch(match, computeMatchId(match))

  // result.matchId, not the id computed above: an upload folded into an existing match has to
  // link to the row that actually holds it, or the mod hands the player a dead link.
  const site = process.env.CESTATS_SITE_URL ?? new URL(req.url).origin
  return NextResponse.json({ ok: true, ...result, url: `${site}/matches/${result.matchId}` })
}
