import { cookies } from 'next/headers'
import { ME_COOKIE } from './me'

/** Reads the identity cookie. Returns null when unset. */
export async function getMe(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(ME_COOKIE)?.value
  return value ? decodeURIComponent(value) : null
}
