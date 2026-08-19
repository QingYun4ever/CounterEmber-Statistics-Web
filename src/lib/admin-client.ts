/** Browser-side helpers for the operator console at /admin. */

const MESSAGES: Record<string, string> = {
  admin_not_configured: '服务器还没有设置 CESTATS_ADMIN_KEY，无法登录',
  pairing_admin_not_configured: '服务器还没有设置 CESTATS_ADMIN_KEY',
  invalid_key: '管理密钥不正确',
  too_many_attempts: '失败次数过多，请等几分钟再试',
  unauthorized: '登录已过期，请重新输入管理密钥',
  bad_origin: '请求来源不匹配，请直接在站点域名下打开本页',
  invalid_request: '请求内容无效',
  internal_error: '服务器出错了，看一下容器日志',
}

export class AdminError extends Error {
  readonly code: string

  constructor(code: string, fallback: string) {
    super(MESSAGES[code] ?? fallback)
    this.code = code
  }
}

/** Fetches an admin endpoint and normalizes both HTTP and `{ok: false}` failures into AdminError. */
export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new AdminError('network', '网络请求失败，站点可能没起来')
  }

  const body = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null
  if (!response.ok || body?.ok === false) {
    throw new AdminError(body?.error ?? String(response.status), `请求失败 HTTP ${response.status}`)
  }
  if (!body) throw new AdminError('bad_response', '返回内容不是有效 JSON')
  return body
}

/** `4分32秒` style countdown; null once the deadline has passed. */
export function countdown(deadline: number, now: number): string | null {
  const left = Math.floor((deadline - now) / 1000)
  if (left <= 0) return null
  const mins = Math.floor(left / 60)
  const secs = left % 60
  return mins > 0 ? `${mins} 分 ${String(secs).padStart(2, '0')} 秒` : `${secs} 秒`
}
