import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, isAdminRequest, originAllowed } from '@/lib/api-auth'
import { listDeviceTokens, revokeDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const revokeSchema = z.object({ id: z.string().uuid() })

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

export async function GET(request: Request) {
  const denied = guard(request, false)
  if (denied) return denied
  return NextResponse.json({ ok: true, devices: listDeviceTokens() }, { headers: NO_STORE })
}

export async function POST(request: Request) {
  const denied = guard(request, true)
  if (denied) return denied

  try {
    const { id } = revokeSchema.parse(await request.json())
    const revoked = revokeDeviceToken(id)
    return NextResponse.json({ ok: true, revoked }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/devices]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
