import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ADMIN_SESSION_COOKIE,
  adminKeyConfigured,
  adminSessionValid,
  clearLoginFailures,
  loginBlocked,
  noteLoginFailure,
  originAllowed,
  readCookie,
  secureRequest,
} from '@/lib/api-auth'
import { adminKeyFingerprint, createAdminSession, deleteAdminSession } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const loginSchema = z.object({ key: z.string().min(1).max(256) })

const NO_STORE = { 'cache-control': 'no-store' }

/** Lets the console tell "wrong key" apart from "server has no admin key at all". */
export async function GET(request: Request) {
  return NextResponse.json(
    {
      ok: true,
      configured: adminKeyConfigured(),
      authenticated: adminSessionValid(readCookie(request, ADMIN_SESSION_COOKIE)),
    },
    { headers: NO_STORE },
  )
}

export async function POST(request: Request) {
  if (!adminKeyConfigured()) {
    return NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 })
  }
  if (!originAllowed(request)) {
    return NextResponse.json({ ok: false, error: 'bad_origin' }, { status: 403 })
  }
  if (loginBlocked(request)) {
    return NextResponse.json({ ok: false, error: 'too_many_attempts' }, { status: 429 })
  }

  let key: string
  try {
    key = loginSchema.parse(await request.json()).key.trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  // Compared through the fingerprint so the raw keys never differ in length-visible ways here.
  const expected = process.env.CESTATS_ADMIN_KEY as string
  if (adminKeyFingerprint(key) !== adminKeyFingerprint(expected)) {
    noteLoginFailure(request)
    return NextResponse.json({ ok: false, error: 'invalid_key' }, { status: 401 })
  }

  clearLoginFailures(request)
  const session = createAdminSession(adminKeyFingerprint(expected))
  const response = NextResponse.json({ ok: true, expiresAt: session.expiresAt }, { headers: NO_STORE })
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: 'strict',
    secure: secureRequest(request),
    path: '/',
    expires: new Date(session.expiresAt),
  })
  return response
}

export async function DELETE(request: Request) {
  if (!originAllowed(request)) {
    return NextResponse.json({ ok: false, error: 'bad_origin' }, { status: 403 })
  }

  const token = readCookie(request, ADMIN_SESSION_COOKIE)
  if (token) deleteAdminSession(token)

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE })
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureRequest(request),
    path: '/',
    maxAge: 0,
  })
  return response
}
