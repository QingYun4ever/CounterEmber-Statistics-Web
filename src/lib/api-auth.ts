import { timingSafeEqual } from 'node:crypto'
import {
  adminKeyFingerprint,
  authenticateAdminSession,
  authenticateDeviceToken,
  type DeviceTokenAuth,
} from './db'

/** Cookie holding an operator console session. httpOnly — the raw admin key never reaches JS. */
export const ADMIN_SESSION_COOKIE = 'cestats_admin'

function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get('authorization')?.trim()
  if (!value) return null
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(value)
  return match?.[1] ?? null
}

/** Authenticates a mod installation token. The raw token is never persisted server-side. */
export function authenticateDevice(request: Request): DeviceTokenAuth | null {
  const token = bearerToken(request) ?? request.headers.get('x-device-token')?.trim() ?? null
  if (!token || token.length < 40 || token.length > 128) return null
  return authenticateDeviceToken(token)
}

/** Admin credentials are separate from all client credentials and are never given to the mod. */
export function adminKeyMatches(request: Request): boolean {
  const expected = process.env.CESTATS_ADMIN_KEY
  return secretMatches(request.headers.get('x-admin-key'), expected)
}

export function adminKeyConfigured(): boolean {
  const key = process.env.CESTATS_ADMIN_KEY
  return Boolean(key && key.length >= 32)
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function adminSessionValid(token: string | null | undefined): boolean {
  const key = process.env.CESTATS_ADMIN_KEY
  if (!token || !key || key.length < 32) return false
  return authenticateAdminSession(token, adminKeyFingerprint(key))
}

/**
 * Authorizes an operator request: either a console session cookie or the raw key in a header,
 * so scripts/create-pair-code.ts and any other tooling keeps working unchanged.
 */
export function isAdminRequest(request: Request): boolean {
  if (!adminKeyConfigured()) return false
  if (adminSessionValid(readCookie(request, ADMIN_SESSION_COOKIE))) return true
  return adminKeyMatches(request)
}

/**
 * Rejects cross-site writes. SameSite=Strict already keeps the session cookie off foreign requests;
 * this is the belt to that suspenders, and it ignores header-authenticated callers (no Origin).
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host)
  } catch {
    return false
  }
}

/** True when the deployment is served over HTTPS, which decides the Secure cookie flag. */
export function secureRequest(request: Request): boolean {
  const site = process.env.CESTATS_SITE_URL
  if (site?.startsWith('https://')) return true
  if (request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https') return true
  return new URL(request.url).protocol === 'https:'
}

const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_FAILURES = 8
const loginFailures = new Map<string, { count: number; first: number }>()

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'local'
}

/**
 * Throttles console logins. The key is 32+ random chars so guessing it is hopeless anyway; this
 * exists so a flood of attempts cannot turn into a stream of expensive requests.
 */
export function loginBlocked(request: Request, now = Date.now()): boolean {
  const entry = loginFailures.get(clientKey(request))
  if (!entry) return false
  if (now - entry.first > LOGIN_WINDOW_MS) return false
  return entry.count >= LOGIN_MAX_FAILURES
}

export function noteLoginFailure(request: Request, now = Date.now()): void {
  const key = clientKey(request)
  const entry = loginFailures.get(key)
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: now })
    return
  }
  entry.count += 1
}

export function clearLoginFailures(request: Request): void {
  loginFailures.delete(clientKey(request))
}

const PUBLIC_WRITE_WINDOW_MS = 10 * 60 * 1000
const PUBLIC_WRITE_MAX = 12
const publicWrites = new Map<string, { count: number; first: number }>()

/**
 * Rate limit for /api/pair/request, the one write that needs no credentials.
 *
 * Counts *successes* rather than failures, unlike the login throttle: every accepted request
 * creates a row, so the thing worth bounding is how many a single source can open. In-memory and
 * per-process, which is fine for a single-container deployment and degrades to "no limit across
 * replicas" rather than to a wrong answer.
 */
export function publicWriteBlocked(request: Request, now = Date.now()): boolean {
  const entry = publicWrites.get(clientKey(request))
  if (!entry) return false
  if (now - entry.first > PUBLIC_WRITE_WINDOW_MS) return false
  return entry.count >= PUBLIC_WRITE_MAX
}

export function notePublicWrite(request: Request, now = Date.now()): void {
  const key = clientKey(request)
  const entry = publicWrites.get(key)
  if (!entry || now - entry.first > PUBLIC_WRITE_WINDOW_MS) {
    publicWrites.set(key, { count: 1, first: now })
    return
  }
  entry.count += 1
}
