import { NextResponse } from 'next/server'
import { z } from 'zod'
import { expectedApiKey, apiKeyMatches } from '@/lib/api-auth'
import { getPingRelay, PING_LONG_POLL_MS } from '@/lib/ping-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const querySchema = z.object({
  channel: z.string().regex(/^[a-f0-9]{32}$/),
  token: z.string().min(20).max(128),
  since: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  wait: z.coerce.number().int().min(0).max(PING_LONG_POLL_MS).default(PING_LONG_POLL_MS),
})

function authorized(request: Request): boolean {
  const expected = expectedApiKey()
  return expected !== null && apiKeyMatches(request.headers.get('x-api-key'), expected)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const state = await getPingRelay().wait(
    parsed.data.channel,
    parsed.data.token,
    parsed.data.since,
    Date.now(),
    parsed.data.wait,
  )
  if (!state) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, ...state }, {
    headers: { 'cache-control': 'no-store' },
  })
}
