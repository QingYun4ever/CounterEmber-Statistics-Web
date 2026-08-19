import { NextResponse } from 'next/server'
import { z } from 'zod'
import { publicWriteBlocked, notePublicWrite } from '@/lib/api-auth'
import { createPairRequest } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Opens a pairing request from inside the game.
 *
 * This is the only unauthenticated write in the app, which is exactly why it hands back nothing of
 * value: a request grants no upload rights until a human approves the short code out-of-band. The
 * throttle and the pending ceiling in createPairRequest are there to keep the table from becoming
 * a place to dump rows.
 */
const requestSchema = z.object({
  player: z.string().trim().min(1).max(32).regex(/^\S+$/),
  installId: z.string().uuid(),
  // Only ever shown to the approver, to help them tell "this is the person in my game" apart.
  server: z.string().trim().max(120).optional(),
})

const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(request: Request) {
  if (publicWriteBlocked(request)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    const input = requestSchema.parse(await request.json())
    notePublicWrite(request)

    const created = createPairRequest(input.player, input.installId, input.server ?? null)
    if (!created) {
      return NextResponse.json({ ok: false, error: 'too_many_pending' }, { status: 503 })
    }

    return NextResponse.json(
      {
        ok: true,
        code: created.code,
        claimSecret: created.claimSecret,
        player: created.player,
        expiresAt: created.expiresAt,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[pair/request]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
