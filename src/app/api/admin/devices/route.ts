import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, adminKeyMatches } from '@/lib/api-auth'
import { listDeviceTokens, revokeDeviceToken } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const revokeSchema = z.object({ id: z.string().uuid() })

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}

export async function GET(request: Request) {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'pairing_admin_not_configured' }, { status: 503 })
  }
  if (!adminKeyMatches(request)) return unauthorized()
  return NextResponse.json(
    { ok: true, devices: listDeviceTokens() },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'pairing_admin_not_configured' }, { status: 503 })
  }
  if (!adminKeyMatches(request)) return unauthorized()

  try {
    const { id } = revokeSchema.parse(await request.json())
    const revoked = revokeDeviceToken(id)
    return NextResponse.json({ ok: true, revoked })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/devices]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
