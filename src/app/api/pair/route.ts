import { NextResponse } from 'next/server'
import { z } from 'zod'
import { redeemPairingCode } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const pairSchema = z.object({
  code: z.string().trim().regex(/^[A-Fa-f0-9]{16}$/),
  player: z.string().trim().min(1).max(32).regex(/^\S+$/),
  installId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const input = pairSchema.parse(await request.json())
    const result = redeemPairingCode(input.code, input.player, input.installId)
    if (!result) {
      return NextResponse.json({ ok: false, error: 'invalid_or_expired_pairing_code' }, { status: 403 })
    }

    return NextResponse.json(
      {
        ok: true,
        deviceId: result.tokenId,
        deviceToken: result.token,
        player: result.player,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[pair]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
