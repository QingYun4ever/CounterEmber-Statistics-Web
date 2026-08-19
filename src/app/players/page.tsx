import Link from 'next/link'
import { Head } from '@/components/Avatar'
import Podium from '@/components/Podium'
import { Card, Empty, PlayerLink, Rating, SectionTitle } from '@/components/ui'
import { fmt1, kd, pct, ratio } from '@/lib/format'
import { leaderboard, type PlayerAgg } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const SORTS = {
  rating: { label: 'Rating', pick: (p: PlayerAgg) => p.avg_rating },
  kast: { label: 'KAST', pick: (p: PlayerAgg) => p.avg_kast },
  adr: { label: 'ADR', pick: (p: PlayerAgg) => p.avg_adr },
  kd: { label: 'K/D', pick: (p: PlayerAgg) => (p.deaths ? p.kills / p.deaths : p.kills) },
  winrate: { label: '胜率', pick: (p: PlayerAgg) => ratio(p.wins, p.matches) },
  opening: { label: '首杀', pick: (p: PlayerAgg) => p.opening_kills },
  matches: { label: '场次', pick: (p: PlayerAgg) => p.matches },
} as const

type SortKey = keyof typeof SORTS

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; min?: string }>
}) {
  const sp = await searchParams
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : 'rating') as SortKey
  const min = Math.max(1, Number(sp.min) || 1)

  const rows = leaderboard(min).sort((a, b) => SORTS[sort].pick(b) - SORTS[sort].pick(a))

  // The podium is always the Rating top three, whatever the table is sorted by.
  const podium = [...rows].sort((a, b) => b.avg_rating - a.avg_rating)

  const header = (key: SortKey, extra = '') => (
    <th className={`px-3 font-medium ${extra}`}>
      <Link
        href={`/players?sort=${key}&min=${min}`}
        className={sort === key ? 'text-accent' : 'hover:text-ink-700'}
      >
        {SORTS[key].label}
        {sort === key ? ' ↓' : ''}
      </Link>
    </th>
  )

  return (
    <div className="grid gap-6">
      <SectionTitle
        title="排行榜"
        hint={`${rows.length} 名玩家 · 最少 ${min} 场`}
        right={
          <div className="flex gap-1 text-xs">
            {[1, 3, 5, 10].map((n) => (
              <Link
                key={n}
                href={`/players?sort=${sort}&min=${n}`}
                className={`rounded-md px-2 py-1 ${
                  min === n ? 'bg-white/80 font-medium text-ink-900 shadow-sm' : 'text-ink-400 hover:bg-white/50'
                }`}
              >
                ≥{n} 场
              </Link>
            ))}
          </div>
        }
      />

      {rows.length === 0 ? (
        <Empty>没有满足条件的玩家。</Empty>
      ) : (
        <>
          {podium.length >= 3 ? (
            <section className="pb-2 pt-4">
              <Podium players={podium} />
            </section>
          ) : null}

          <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="py-3 pl-4 text-left font-medium">#</th>
                  <th className="py-3 text-left font-medium">玩家</th>
                  <th className="px-3 text-right font-medium">
                    <Link
                      href={`/players?sort=matches&min=${min}`}
                      className={sort === 'matches' ? 'text-accent' : 'hover:text-ink-700'}
                    >
                      场次{sort === 'matches' ? ' ↓' : ''}
                    </Link>
                  </th>
                  {header('winrate', 'text-right')}
                  {header('rating', 'text-right')}
                  {header('kast', 'text-right')}
                  {header('adr', 'text-right')}
                  {header('kd', 'text-right')}
                  {header('opening', 'text-right')}
                  <th className="py-3 pr-4 text-right font-medium">MVP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.player} className="border-t border-white/70 hover:bg-white/40">
                    <td className="num py-2.5 pl-4 text-ink-300">{i + 1}</td>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Head name={p.player} size={26} />
                        <PlayerLink name={p.player} className="font-medium text-ink-900" />
                      </span>
                    </td>
                    <td className="num px-3 text-right text-ink-500">{p.matches}</td>
                    <td className="num px-3 text-right text-ink-700">
                      {pct(ratio(p.wins, p.matches))}
                    </td>
                    <td className="px-3 text-right">
                      <Rating value={p.avg_rating} />
                    </td>
                    <td className="num px-3 text-right text-ink-700">{pct(p.avg_kast)}</td>
                    <td className="num px-3 text-right text-ink-700">{fmt1(p.avg_adr)}</td>
                    <td className="num px-3 text-right text-ink-700">{kd(p.kills, p.deaths)}</td>
                    <td className="num px-3 text-right text-ink-500">{p.opening_kills}</td>
                    <td className="num py-2.5 pr-4 text-right text-gold">{p.mvps || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Card>
        </>
      )}

      <p className="text-xs text-ink-400">
        Rating / KAST / ADR 为服务器结算值的平均；首杀为本地推断。
      </p>
    </div>
  )
}
