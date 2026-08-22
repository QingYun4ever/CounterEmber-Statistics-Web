'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { QQ_GROUP } from '@/lib/site'

/**
 * First-visit disclaimer on the homepage.
 *
 * Two levels of dismissal on purpose: 「知道了」 only quiets it for this tab (sessionStorage), while
 * 「不再提醒」 is permanent (localStorage). The key is versioned so a materially different notice
 * can be shown again later without stranding people who already clicked the permanent option.
 */
const FOREVER_KEY = 'cestats_notice_v2_dismissed'
const SESSION_KEY = 'cestats_notice_v2_seen'

export default function HomeNotice() {
  // Never true on the server: the flags live in the browser, so the first paint has no dialog and
  // there is nothing for hydration to disagree about.
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(FOREVER_KEY) === '1') return
      if (sessionStorage.getItem(SESSION_KEY) === '1') return
    } catch {
      // Private mode can throw on storage access; showing the notice is the safe fallback.
    }
    setOpen(true)
  }, [])

  const close = useCallback((forever: boolean) => {
    try {
      if (forever) localStorage.setItem(FOREVER_KEY, '1')
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // Dismissal just won't persist; the dialog still closes.
    }
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false)
    }
    document.addEventListener('keydown', onKey)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, close])

  if (!open) return null

  async function copyGroup() {
    const ok = await copyText(QQ_GROUP)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-900/25 p-5 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) close(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cestats-notice-title"
        className="glass rise w-full max-w-lg p-7"
      >
        <h2 id="cestats-notice-title" className="text-lg font-semibold tracking-tight text-ink-900">
          这是玩家自建的第三方统计站
        </h2>

        <div className="mt-4 grid gap-3 text-sm leading-relaxed text-ink-700">
          <p>
            本站<strong className="font-semibold">不是 IMC 官方站点</strong>，数据不代表官方战绩。
          </p>
          <p>
            所有对局都由装了 CE Stats mod 的玩家赛后
            <strong className="font-semibold">自行上传</strong>
            ，本站不保证其真实性；上传者当时没看全的比赛也会有缺漏。
          </p>
        </div>

        <div className="mt-5 rounded-xl border border-white/70 bg-white/55 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.09em] text-ink-400">
            想让自己的比赛也出现在这里
          </p>
          <ol className="mt-2.5 grid gap-2 text-sm text-ink-700">
            <li className="flex gap-2.5">
              <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink-900/85 text-[10px] font-semibold text-white">
                1
              </span>
              <span>
                装上 mod（在{' '}
                <Link
                  href="/download"
                  onClick={() => close(false)}
                  className="text-accent hover:underline"
                >
                  下载
                </Link>{' '}
                页）。
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink-900/85 text-[10px] font-semibold text-white">
                2
              </span>
              <span>
                游戏里执行{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5">/cestats bind</code>
                ，拿一个 6 位绑定码。
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink-900/85 text-[10px] font-semibold text-white">
                3
              </span>
              <span>
                在 QQ 群{' '}
                <button
                  type="button"
                  onClick={copyGroup}
                  title="点击复制群号"
                  className="num rounded-md bg-white/80 px-1.5 py-0.5 font-semibold text-ink-900 transition-colors hover:bg-white"
                >
                  {copied ? '已复制' : QQ_GROUP}
                </button>{' '}
                发{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5">/配对 绑定码</code>
                ，机器人批准后游戏里会自动配对完成。
              </span>
            </li>
          </ol>
          <p className="mt-2.5 text-xs text-ink-400">
            绑定码 20 分钟有效，可以直接发在群里——它只是一张申领单，不是凭据。
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => close(true)}
            className="rounded-lg border border-white/70 bg-white/60 px-4 py-2 text-sm text-ink-500 transition-colors hover:bg-white/80 hover:text-ink-700"
          >
            不再提醒
          </button>
          <button
            type="button"
            onClick={() => close(false)}
            autoFocus
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-ink-700"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
