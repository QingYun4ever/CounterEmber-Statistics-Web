'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { writeMe } from '@/lib/me'
import { Card } from './ui'

/** Asks who you are, then remembers it. Only rendered when no identity is set. */
export default function MePicker({ names }: { names: string[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? names.filter((n) => n.toLowerCase().includes(q)) : names
    return list.slice(0, 60)
  }, [names, query])

  function choose(name: string) {
    writeMe(name)
    router.push(`/players/${encodeURIComponent(name)}`)
    router.refresh()
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">你是哪位？</h1>
        <p className="mt-1 text-sm text-ink-400">
          选一次就记住，之后点导航栏的「我」直接进自己的主页。只存在这台设备的浏览器里。
        </p>
      </div>

      <Card className="p-5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索游戏 ID…"
          autoFocus
          className="w-full rounded-xl border border-white/70 bg-white/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-300 focus:border-accent/40"
        />

        {names.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400">还没有任何玩家数据。</p>
        ) : (
          <div className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => choose(name)}
                className="rounded-lg px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-white/70 hover:text-ink-900"
              >
                {name}
              </button>
            ))}
            {matches.length === 0 ? <p className="text-sm text-ink-400">没有匹配的 ID。</p> : null}
          </div>
        )}
      </Card>
    </div>
  )
}
