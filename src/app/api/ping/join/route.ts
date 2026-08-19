import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateDevice } from '@/lib/api-auth'
import { derivePingChannel, getPingRelay } from '@/lib/ping-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const joinSchema = z.object({
  mode: z.enum(['auto', 'code']),
  matchKey: z.string().trim().min(1).max(256),
  teamKey: z.string().trim().min(1).max(256),
  player: z.string().regex(/^[a-f0-9]{32}$/),
})

export async function POST(request: Request) {
  if (!authenticateDevice(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const input = joinSchema.parse(await request.json())
    const channel = derivePingChannel(input.mode, input.matchKey, input.teamKey)
    const joined = getPingRelay().join(channel, input.player, Date.now())
    return NextResponse.json({ ok: true, token: joined.token, ...joined.state }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_request', details: error.flatten() }, { status: 400 })
    }
    console.error('[ping/join]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
