import { NextResponse } from 'next/server'
import { z } from 'zod'
import { expectedApiKey, apiKeyMatches } from '@/lib/api-auth'
import { getPingRelay, PING_MAX_PER_CHANNEL, PING_MAX_PER_PLAYER } from '@/lib/ping-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const publishSchema = z.object({
  channel: z.string().regex(/^[a-f0-9]{32}$/),
  token: z.string().min(20).max(128),
  id: z.string().min(1).max(96),
  owner: z.string().regex(/^[a-f0-9]{32}$/),
  kind: z.enum(['normal', 'warning']),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  dimension: z.string().trim().min(1).max(128),
})

function authorized(request: Request): boolean {
  const expected = expectedApiKey()
  return expected !== null && apiKeyMatches(request.headers.get('x-api-key'), expected)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const input = publishSchema.parse(await request.json())
    if (Math.abs(input.x) > 30_000_000 || Math.abs(input.y) > 30_000_000 || Math.abs(input.z) > 30_000_000) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 })
    }

    const result = getPingRelay().publish(input.channel, input.token, {
      id: input.id,
      owner: input.owner,
      kind: input.kind,
      x: input.x,
      y: input.y,
      z: input.z,
      dimension: input.dimension,
    }, Date.now())

    if ('error' in result) {
      if (result.error === 'unauthorized') {
        return NextResponse.json({ error: result.error }, { status: 401 })
      }
      return NextResponse.json({
        error: result.error,
        retryAfterMs: result.retryAfterMs,
        limits: { perPlayer: PING_MAX_PER_PLAYER, perChannel: PING_MAX_PER_CHANNEL },
      }, { status: 429 })
    }

    return NextResponse.json({ ok: true, ...result.state }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_request', details: error.flatten() }, { status: 400 })
    }
    console.error('[ping/publish]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
