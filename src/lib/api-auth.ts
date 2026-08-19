import { timingSafeEqual } from 'node:crypto'

/** API-key check shared by the persistent ingest endpoint and the ephemeral ping relay. */
const INSECURE_KEYS = new Set(['dev-key', 'cestats-change-me'])
let warnedAboutKey = false

export function expectedApiKey(): string | null {
  const key = process.env.CESTATS_API_KEY
  if (key) {
    if (process.env.NODE_ENV === 'production' && INSECURE_KEYS.has(key) && !warnedAboutKey) {
      warnedAboutKey = true
      console.warn(
        `[cestats] CESTATS_API_KEY 仍是默认值 "${key}"。站点一旦暴露到公网，任何人都能写入数据库。` +
          ' 请设置一个随机密钥：openssl rand -hex 24',
      )
    }
    return key
  }
  // Never fall back to a default in production — an open endpoint is worse than a broken one.
  return process.env.NODE_ENV === 'production' ? null : 'dev-key'
}

export function apiKeyMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
