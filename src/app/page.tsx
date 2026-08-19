import Link from 'next/link'
import { Head } from '@/components/Avatar'
import HomeNotice from '@/components/HomeNotice'
import MatchList from '@/components/MatchList'
import { Card, Empty, Kpi, PlayerLink, Rating, SectionTitle } from '@/components/ui'
import { fmt1, kd, pct } from '@/lib/format'
import { getMe } from '@/lib/me-server'
import { leaderboard, overview, playersForMatches, recentMatches } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const stats = overview()
  const matches = recentMatches(8)
  const playersByMatch = playersForMatches(matches.map((m) => m.id))
  const top = leaderboard(1).slice(0, 8)
  const me = await getMe()

  if (stats.matches === 0) {
    return (
      <>
        <HomeNotice />
        <Empty>
          还没有数据。启动 mod 打一把，或先跑一次{' '}
          <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">npm run import-log</code>{' '}
          导入日志。
        </Empty>
      </>
    )
  }

  return (
    <div className="grid gap-9">
      <HomeNotice />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">总览</h1>
        <p className="mt-1 text-sm text-ink-400">团队爆破 · 对局数据</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="比赛" value={stats.matches} sub={`${stats.complete} 场完整观测`} i={0} />
        <Kpi label="玩家" value={stats.players} i={1} />
        <Kpi label="回合" value={stats.rounds} i={2} />
        <Kpi label="击杀" value={stats.kills} i={3} />
      </div>

      <section>
        <SectionTitle
          title="Rating 排行"
          hint="所有场次平均"
          right={
            <Link href="/players" className="text-xs text-accent hover:underline">
              查看全部 →
            </Link>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {top.map((p, i) => (
            <Card key={p.player} i={i} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Head name={p.player} size={24} />
                  <PlayerLink name={p.player} className="truncate text-sm font-medium text-ink-900" />
                </span>
                <span className="num shrink-0 text-[11px] text-ink-300">#{i + 1}</span>
              </div>
              <div className="mt-2">
                <Rating value={p.avg_rating} className="text-2xl" />
              </div>
              <div className="num mt-1.5 flex gap-3 text-[11px] text-ink-400">
                <span>{p.matches} 场</span>
                <span>KAST {pct(p.avg_kast)}</span>
                <span>ADR {fmt1(p.avg_adr)}</span>
                <span>K/D {kd(p.kills, p.deaths)}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          title="最近比赛"
          right={
            <Link href="/matches" className="text-xs text-accent hover:underline">
              查看全部 →
            </Link>
          }
        />
        <MatchList matches={matches} playersByMatch={playersByMatch} perspective={me ?? undefined} />
      </section>
    </div>
  )
}
