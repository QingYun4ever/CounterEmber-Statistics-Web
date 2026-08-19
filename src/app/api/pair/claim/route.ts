import { NextResponse } from 'next/server'
import { z } from 'zod'
import { claimPairRequest } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The client polls here until a human has approved its code.
 *
 * The claim secret is the credential — it never appears in a chat group, so this endpoint needs no
 * other authentication. `installId` must still match the one that opened the request, which keeps a
 * copied secret from being useful on a different machine.
 */
const claimSchema = z.object({
  claimSecret: z.string().min(32).max(128),
  installId: z.string().uuid(),
})

const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(request: Request) {
  try {
    const input = claimSchema.parse(await request.json())
    const result = claimPairRequest(input.claimSecret, input.installId)

    if (result.status === 'unknown') {
      return NextResponse.json(
        { ok: false, error: 'unknown_or_expired_request' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.status === 'pending') {
      return NextResponse.json(
        { ok: true, status: 'pending', player: result.player, expiresAt: result.expiresAt },
        { headers: NO_STORE },
      )
    }

    return NextResponse.json(
      {
        ok: true,
        status: 'paired',
        player: result.player,
        deviceId: result.deviceId,
        deviceToken: result.deviceToken,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[pair/claim]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
