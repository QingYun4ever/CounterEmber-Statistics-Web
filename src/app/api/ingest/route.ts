import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { saveMatch } from '@/lib/db'
import { computeMatchId, zMatch } from '@/lib/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Keys shipped as defaults. Fine locally, a hole on a public address. */
const INSECURE_KEYS = new Set(['dev-key', 'cestats-change-me'])
let warnedAboutKey = false

function expectedKey(): string | null {
  const key = process.env.CESTATS_API_KEY
  if (key) {
    if (process.env.NODE_ENV === 'production' && INSECURE_KEYS.has(key) && !warnedAboutKey) {
      warnedAboutKey = true
      console.warn(
        `[cestats] CESTATS_API_KEY 仍是默认值 "${key}"。站点一旦暴露到公网，任何人都能写入数据库。` +
          ' 请设置一个随机密钥：openssl rand -hex 24',
      )
    }
    return key
  }
  // Never fall back to a default in production — an open write endpoint is worse than a broken one.
  return process.env.NODE_ENV === 'production' ? null : 'dev-key'
}

function keyMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const expected = expectedKey()
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CESTATS_API_KEY is not configured; writes are refused' },
      { status: 503 },
    )
  }
  if (!keyMatches(req.headers.get('x-api-key'), expected)) {
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
  const matchId = computeMatchId(match)
  const result = saveMatch(match, matchId)

  const site = process.env.CESTATS_SITE_URL ?? new URL(req.url).origin
  return NextResponse.json({ ok: true, ...result, url: `${site}/matches/${matchId}` })
}
