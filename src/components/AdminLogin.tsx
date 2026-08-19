'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { adminFetch } from '@/lib/admin-client'
import { Card } from './ui'

/**
 * Gate for /admin. The key is posted once and traded for an httpOnly session cookie, so it never
 * lives in localStorage and is not readable by anything running on the page afterwards.
 */
export default function AdminLogin({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !key.trim()) return
    setBusy(true)
    setError(null)
    try {
      await adminFetch('/api/admin/session', {
        method: 'POST',
        body: JSON.stringify({ key: key.trim() }),
      })
      setKey('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-md gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">站长控制台</h1>
        <p className="mt-1 text-sm text-ink-400">发放一次性配对码、管理已配对的设备</p>
      </div>

      <Card className="p-6">
        {configured ? (
          <form onSubmit={submit} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.09em] text-ink-400">
                管理密钥
              </span>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="服务器上的 CESTATS_ADMIN_KEY"
                className="num w-full rounded-xl border border-white/70 bg-white/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-300 focus:border-accent/40"
              />
            </label>

            {error ? <p className="text-sm text-bad">{error}</p> : null}

            <button
              type="submit"
              disabled={busy || !key.trim()}
              className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-ink-700 disabled:opacity-40"
            >
              {busy ? '验证中…' : '登录'}
            </button>

            <p className="text-xs text-ink-400">
              登录状态存在这台浏览器的 httpOnly cookie 里，12 小时后过期；
              在服务器上换掉 <code className="rounded bg-white/70 px-1 py-0.5">CESTATS_ADMIN_KEY</code>{' '}
              会立刻踢掉所有已登录的浏览器。
            </p>
          </form>
        ) : (
          <div className="grid gap-3 text-sm text-ink-700">
            <p className="font-medium">服务器还没有设置管理密钥。</p>
            <p className="text-ink-500">
              在 <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">web/.env</code> 里写入至少
              32 个随机字符的 <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">CESTATS_ADMIN_KEY</code>
              ，然后重启站点：
            </p>
            <pre className="num overflow-x-auto rounded-xl bg-ink-900/90 p-4 text-xs leading-relaxed text-white">
              {`echo "CESTATS_ADMIN_KEY=$(openssl rand -hex 32)" >> .env
docker compose up -d`}
            </pre>
          </div>
        )}
      </Card>
    </div>
  )
}
