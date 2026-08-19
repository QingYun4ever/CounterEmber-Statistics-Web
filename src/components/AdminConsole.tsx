'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminError, adminFetch, countdown } from '@/lib/admin-client'
import { copyText } from '@/lib/clipboard'
import type { DeviceTokenSummary, PairingCodeSummary } from '@/lib/db'
import { fmtDate, relative } from '@/lib/format'
import { Card, Pill, SectionTitle } from './ui'

type IssuedCode = { id: string; code: string; player: string; expiresAt: number }

/**
 * Ticks once a second, but stays null until mount.
 *
 * Nothing time-dependent may render on the server here: the operator's browser and the container
 * can sit in different timezones, and a formatted date that differs between the two renders is a
 * hydration mismatch. So every timestamp in this file waits for the clock.
 */
function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** A timestamp that only appears once the client clock exists. */
function At({ ms, now }: { ms: number; now: number | null }) {
  return <span className="num text-xs text-ink-400">{now === null ? '—' : fmtDate(ms)}</span>
}

function CopyButton({
  text,
  label,
  tone = 'ghost',
}: {
  text: string
  label: string
  tone?: 'solid' | 'ghost'
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  async function run() {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'failed')
    setTimeout(() => setState('idle'), 1800)
  }

  const styles =
    tone === 'solid'
      ? 'bg-ink-900 text-white hover:bg-ink-700'
      : 'border border-white/70 bg-white/60 text-ink-700 hover:bg-white/80'

  return (
    <button
      type="button"
      onClick={run}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${styles}`}
    >
      {state === 'done' ? '已复制' : state === 'failed' ? '复制失败，请手动选中' : label}
    </button>
  )
}

/**
 * Operator console: hands out one-time pairing codes and revokes device tokens.
 *
 * Codes are shown exactly once — the server only stores their hash — so the freshly issued code
 * gets its own panel with copy buttons and a countdown, rather than living in the history list.
 */
export default function AdminConsole({
  players,
  initialCodes,
  initialDevices,
  ingestEnabled,
}: {
  players: string[]
  initialCodes: PairingCodeSummary[]
  initialDevices: DeviceTokenSummary[]
  ingestEnabled: boolean
}) {
  const router = useRouter()
  const now = useClock()

  const [player, setPlayer] = useState('')
  const [codes, setCodes] = useState(initialCodes)
  const [devices, setDevices] = useState(initialDevices)
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** An expired session has to bounce back to the login form, not silently fail every button. */
  const handle = useCallback(
    (e: unknown) => {
      if (e instanceof AdminError && e.code === 'unauthorized') router.refresh()
      setError(e instanceof Error ? e.message : '操作失败')
    },
    [router],
  )

  const reload = useCallback(async () => {
    try {
      const [codeList, deviceList] = await Promise.all([
        adminFetch<{ codes: PairingCodeSummary[] }>('/api/admin/pairing'),
        adminFetch<{ devices: DeviceTokenSummary[] }>('/api/admin/devices'),
      ])
      setCodes(codeList.codes)
      setDevices(deviceList.devices)
    } catch (e) {
      handle(e)
    }
  }, [handle])

  const suggestions = useMemo(() => {
    const paired = new Set(devices.filter((d) => d.revokedAt === null).map((d) => d.player))
    return players.map((name) => ({ name, paired: paired.has(name) }))
  }, [players, devices])

  async function issue(event: React.FormEvent) {
    event.preventDefault()
    const name = player.trim()
    if (!name || busy) return
    setBusy('issue')
    setError(null)
    try {
      const result = await adminFetch<IssuedCode>('/api/admin/pairing', {
        method: 'POST',
        body: JSON.stringify({ player: name }),
      })
      setIssued(result)
      setPlayer('')
      await reload()
    } catch (e) {
      handle(e)
    } finally {
      setBusy(null)
    }
  }

  async function cancelCode(id: string) {
    setBusy(id)
    setError(null)
    try {
      await adminFetch('/api/admin/pairing', { method: 'DELETE', body: JSON.stringify({ id }) })
      if (issued?.id === id) setIssued(null)
      await reload()
    } catch (e) {
      handle(e)
    } finally {
      setBusy(null)
    }
  }

  /** Revoking cannot be undone from here — the player needs a fresh code — so it asks first. */
  async function revokeDevice(device: DeviceTokenSummary) {
    const confirmed = window.confirm(
      `撤销 ${device.player} 的这台设备（${device.installId.slice(0, 8)}）？\n` +
        '这台客户端会立刻无法上传，要恢复只能重新发一个配对码。',
    )
    if (!confirmed) return

    setBusy(device.id)
    setError(null)
    try {
      await adminFetch('/api/admin/devices', {
        method: 'POST',
        body: JSON.stringify({ id: device.id }),
      })
      await reload()
    } catch (e) {
      handle(e)
    } finally {
      setBusy(null)
    }
  }

  async function logout() {
    setBusy('logout')
    try {
      await adminFetch('/api/admin/session', { method: 'DELETE' })
    } catch {
      // Logging out is best-effort; refreshing will land on the login form either way.
    }
    router.refresh()
  }

  const pending = codes.filter((c) => c.usedAt === null && (now === null || c.expiresAt > now))
  const activeDevices = devices.filter((d) => d.revokedAt === null)

  return (
    <div className="grid gap-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">站长控制台</h1>
          <p className="mt-1 text-sm text-ink-400">
            {activeDevices.length} 台设备已配对 · {pending.length} 个配对码待使用
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ingestEnabled ? null : <Pill tone="bad">上传已全局关闭</Pill>}
          <button
            type="button"
            onClick={logout}
            disabled={busy === 'logout'}
            className="rounded-lg border border-white/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-white/80"
          >
            退出登录
          </button>
        </div>
      </div>

      {error ? (
        <Card className="border-rose-100 bg-rose-50/70 p-4 text-sm text-bad">{error}</Card>
      ) : null}

      <section>
        <SectionTitle
          title="发放配对码"
          hint="配对码 15 分钟内有效、只能用一次，且只有填在这里的玩家能用它配对"
        />
        <Card className="p-6">
          <form onSubmit={issue} className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[16rem] flex-1 gap-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.09em] text-ink-400">
                Minecraft 游戏 ID
              </span>
              <input
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                list="cestats-players"
                autoFocus
                spellCheck={false}
                placeholder="大小写必须和游戏内完全一致"
                className="w-full rounded-xl border border-white/70 bg-white/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-300 focus:border-accent/40"
              />
              <datalist id="cestats-players">
                {suggestions.map((s) => (
                  <option key={s.name} value={s.name} label={s.paired ? '已有配对设备' : undefined} />
                ))}
              </datalist>
            </label>
            <button
              type="submit"
              disabled={busy === 'issue' || !player.trim()}
              className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-ink-700 disabled:opacity-40"
            >
              {busy === 'issue' ? '生成中…' : '生成配对码'}
            </button>
          </form>

          {issued ? <IssuedPanel issued={issued} now={now} /> : null}
        </Card>
      </section>

      <section>
        <SectionTitle
          title="配对码记录"
          hint="服务端只存哈希，所以离开这个页面后配对码就再也看不到了，需要就重新生成"
        />
        {codes.length === 0 ? (
          <Card className="p-8 text-center text-sm text-ink-400">还没有发放过配对码。</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-white/60 text-left text-[11px] uppercase tracking-[0.09em] text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-medium">玩家</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">生成时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => {
                  const expired = now !== null && code.usedAt === null && code.expiresAt <= now
                  const left = now === null ? null : countdown(code.expiresAt, now)
                  return (
                    <tr key={code.id} className="border-b border-white/40 last:border-0">
                      <td className="px-5 py-3 font-medium text-ink-900">{code.player}</td>
                      <td className="px-5 py-3">
                        {code.usedAt !== null ? (
                          <Pill tone="good">已配对</Pill>
                        ) : expired ? (
                          <Pill>已过期</Pill>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Pill tone="gold">待使用</Pill>
                            <span className="num text-xs text-ink-400">{left ?? '—'}</span>
                          </span>
                        )}
                        {code.attempts > 0 ? (
                          <span className="num ml-2 text-xs text-bad">
                            {code.attempts} 次玩家名不符
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-5 py-3 text-xs text-ink-400">
                        <At ms={code.createdAt} now={now} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {code.usedAt === null && !expired ? (
                          <button
                            type="button"
                            onClick={() => cancelCode(code.id)}
                            disabled={busy === code.id}
                            className="rounded-lg border border-white/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-white/80 disabled:opacity-40"
                          >
                            作废
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle
          title="已配对设备"
          hint="每台安装一个独立令牌；撤销后这台客户端立刻无法上传，其他设备不受影响"
        />
        {devices.length === 0 ? (
          <Card className="p-8 text-center text-sm text-ink-400">
            还没有设备完成配对。发一个配对码给玩家，让他在游戏里执行{' '}
            <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">/cestats pair &lt;配对码&gt;</code>。
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-white/60 text-left text-[11px] uppercase tracking-[0.09em] text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-medium">玩家</th>
                  <th className="px-5 py-3 font-medium">安装</th>
                  <th className="px-5 py-3 font-medium">配对时间</th>
                  <th className="px-5 py-3 font-medium">最近活动</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr
                    key={device.id}
                    className={`border-b border-white/40 last:border-0 ${
                      device.revokedAt !== null ? 'opacity-45' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <span className="font-medium text-ink-900">{device.player}</span>
                      {device.revokedAt !== null ? (
                        <span className="ml-2">
                          <Pill tone="bad">已撤销</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="num px-5 py-3 text-xs text-ink-400" title={device.installId}>
                      {device.installId.slice(0, 8)}
                    </td>
                    <td className="num px-5 py-3 text-xs text-ink-400">
                      <At ms={device.createdAt} now={now} />
                    </td>
                    <td className="num px-5 py-3 text-xs text-ink-400">
                      {now === null ? '—' : relative(device.lastSeenAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {device.revokedAt === null ? (
                        <button
                          type="button"
                          onClick={() => revokeDevice(device)}
                          disabled={busy === device.id}
                          className="rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-1.5 text-xs font-medium text-bad transition-colors hover:bg-rose-100/70 disabled:opacity-40"
                        >
                          撤销
                        </button>
                      ) : (
                        <At ms={device.revokedAt} now={now} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}

/** The one and only chance to read a code, so it gets the big type and both copy shapes. */
function IssuedPanel({ issued, now }: { issued: IssuedCode; now: number | null }) {
  const command = `/cestats pair ${issued.code}`
  const left = now === null ? null : countdown(issued.expiresAt, now)

  return (
    <div className="mt-6 rounded-xl border border-accent/25 bg-accent/[0.06] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink-500">
          发给 <strong className="font-semibold text-ink-900">{issued.player}</strong> ·{' '}
          {left ? `剩余 ${left}` : '已过期，请重新生成'}
        </div>
        <span className="text-[11px] text-ink-400">只显示这一次</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="num select-all rounded-lg bg-white/80 px-4 py-2.5 text-xl font-semibold tracking-[0.18em] text-ink-900">
          {issued.code}
        </code>
        <CopyButton text={issued.code} label="复制配对码" />
        <CopyButton text={command} label="复制整条命令" tone="solid" />
      </div>

      <p className="mt-3 text-xs text-ink-500">
        让 {issued.player} 在游戏里执行{' '}
        <code className="num rounded bg-white/70 px-1.5 py-0.5">{command}</code>
        。配对码只对这个 ID 有效，别人拿到也用不了。
      </p>
    </div>
  )
}
