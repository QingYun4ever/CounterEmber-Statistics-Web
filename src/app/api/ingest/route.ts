import { NextResponse } from 'next/server'
import { saveMatch } from '@/lib/db'
import { expectedApiKey, apiKeyMatches } from '@/lib/api-auth'
import { computeMatchId, zMatch } from '@/lib/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const expected = expectedApiKey()
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CESTATS_API_KEY is not configured; writes are refused' },
      { status: 503 },
    )
  }
  if (!apiKeyMatches(req.headers.get('x-api-key'), expected)) {
    return NextResponse.json({ ok: false, error: 'invalid api key' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
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

  // The id is always recomputed here: a buggy client must not be able to create duplicates.
  const match = parsed.data
  const result = saveMatch(match, computeMatchId(match))

  // result.matchId, not the id computed above: an upload folded into an existing match has to
  // link to the row that actually holds it, or the mod hands the player a dead link.
  const site = process.env.CESTATS_SITE_URL ?? new URL(req.url).origin
  return NextResponse.json({ ok: true, ...result, url: `${site}/matches/${result.matchId}` })
}
