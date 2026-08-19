import { timingSafeEqual } from 'node:crypto'
import { authenticateDeviceToken, type DeviceTokenAuth } from './db'

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
