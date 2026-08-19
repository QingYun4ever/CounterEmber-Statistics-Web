import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, adminKeyMatches } from '@/lib/api-auth'
import { issuePairingCode } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const requestSchema = z.object({
  player: z.string().trim().min(1).max(32).regex(/^\S+$/),
})

export async function POST(request: Request) {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'pairing_admin_not_configured' }, { status: 503 })
  }
  if (!adminKeyMatches(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const input = requestSchema.parse(await request.json())
    const result = issuePairingCode(input.player)
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pairing]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
