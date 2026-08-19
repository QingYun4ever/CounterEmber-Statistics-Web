import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, isAdminRequest, originAllowed } from '@/lib/api-auth'
import { cancelPairingCode, issuePairingCode, listPairingCodes } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const requestSchema = z.object({
  player: z.string().trim().min(1).max(32).regex(/^\S+$/),
})

/** A stored code hash, which is all the server keeps of a code. */
const cancelSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) })

const NO_STORE = { 'cache-control': 'no-store' }

function guard(request: Request, write: boolean): NextResponse | null {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'pairing_admin_not_configured' }, { status: 503 })
  }
  if (write && !originAllowed(request)) {
    return NextResponse.json({ ok: false, error: 'bad_origin' }, { status: 403 })
  }
  if (!isAdminRequest(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  return null
}

/** Recent codes for the console. The codes themselves are unrecoverable — only hashes are stored. */
export async function GET(request: Request) {
  const denied = guard(request, false)
  if (denied) return denied
  return NextResponse.json({ ok: true, codes: listPairingCodes() }, { headers: NO_STORE })
}

export async function POST(request: Request) {
  const denied = guard(request, true)
  if (denied) return denied

  try {
    const input = requestSchema.parse(await request.json())
    const result = issuePairingCode(input.player)
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pairing]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}

/** Drops a code that has not been redeemed yet — e.g. it was handed to the wrong player. */
export async function DELETE(request: Request) {
  const denied = guard(request, true)
  if (denied) return denied

  try {
    const { id } = cancelSchema.parse(await request.json())
    return NextResponse.json({ ok: true, cancelled: cancelPairingCode(id) }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pairing]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
