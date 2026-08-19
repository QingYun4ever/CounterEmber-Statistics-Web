import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, isAdminRequest, originAllowed } from '@/lib/api-auth'
import { lookupPairRequest } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Resolves a bind code to the player who opened it, without approving anything.
 *
 * The QQ bot needs this: its whole job is to check the code's player against its QQ↔ID binding
 * table, and it cannot do that until the site tells it whose request this is. Kept separate from
 * the approve endpoint so a lookup can never approve by accident.
 *
 * POST rather than GET so the code stays out of access logs and referrers.
 */
const lookupSchema = z.object({ code: z.string().trim().min(4).max(24) })

const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(request: Request) {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'pairing_admin_not_configured' }, { status: 503 })
  }
  if (!originAllowed(request)) {
    return NextResponse.json({ ok: false, error: 'bad_origin' }, { status: 403 })
  }
  if (!isAdminRequest(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const { code } = lookupSchema.parse(await request.json())
    const found = lookupPairRequest(code)
    if (!found) {
      return NextResponse.json(
        { ok: false, error: 'unknown_or_expired_code' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json({ ok: true, request: found }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pair-requests/lookup]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
