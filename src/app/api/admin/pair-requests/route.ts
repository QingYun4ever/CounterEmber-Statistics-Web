import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminKeyConfigured, isAdminRequest, originAllowed } from '@/lib/api-auth'
import { approvePairRequest, listPairRequests, rejectPairRequest } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** A stored code hash — how the console refers to a request it never saw the code for. */
const idSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) })

/** The QQ bot approves by code; the console approves by id. Exactly one of the two. */
const approveSchema = z.union([
  z.object({
    code: z.string().trim().min(4).max(24),
    /** Who to record in the audit trail — a QQ number, or a label like "console". */
    approvedBy: z.string().trim().min(1).max(64).optional(),
  }),
  idSchema.extend({ approvedBy: z.string().trim().min(1).max(64).optional() }),
])

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

/** Requests currently waiting for a human, for the console's pending list. */
export async function GET(request: Request) {
  const denied = guard(request, false)
  if (denied) return denied
  return NextResponse.json({ ok: true, requests: listPairRequests() }, { headers: NO_STORE })
}

/**
 * Approves a request. The approver never receives a token — the client still has to claim it with
 * the secret only it holds, so approving somebody else's code just completes their pairing.
 */
export async function POST(request: Request) {
  const denied = guard(request, true)
  if (denied) return denied

  try {
    const input = approveSchema.parse(await request.json())
    const selector = 'code' in input ? { code: input.code } : { id: input.id }
    const result = approvePairRequest(selector, input.approvedBy ?? 'console')

    if (result.status === 'unknown') {
      return NextResponse.json(
        { ok: false, error: 'unknown_or_expired_code' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { ok: true, status: result.status, request: result.request },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pair-requests]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}

/** Refuses a request outright, so a code someone else opened cannot sit there waiting. */
export async function DELETE(request: Request) {
  const denied = guard(request, true)
  if (denied) return denied

  try {
    const { id } = idSchema.parse(await request.json())
    return NextResponse.json({ ok: true, rejected: rejectPairRequest(id) }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }
    console.error('[admin/pair-requests]', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
