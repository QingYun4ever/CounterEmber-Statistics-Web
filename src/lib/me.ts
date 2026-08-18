/**
 * Which player "I" am.
 *
 * The site is public and has no accounts, so identity is just a convenience: it decides which
 * profile the 「我」 tab opens and which scoreboard row is highlighted. It lives in a cookie
 * rather than localStorage so the server renders the right thing on the first paint — with
 * localStorage every page would flash a placeholder until hydration.
 */
export const ME_COOKIE = 'cestats_me'

const ONE_YEAR = 60 * 60 * 24 * 365

/** Client-side write. Call `router.refresh()` afterwards so server components pick it up. */
export function writeMe(name: string | null): void {
  if (typeof document === 'undefined') return
  document.cookie = name
    ? `${ME_COOKIE}=${encodeURIComponent(name)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
    : `${ME_COOKIE}=; path=/; max-age=0; samesite=lax`
}
