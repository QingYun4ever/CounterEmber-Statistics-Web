import Link from 'next/link'
import MatchList from '@/components/MatchList'
import { Empty, SectionTitle } from '@/components/ui'
import { getMe } from '@/lib/me-server'
import { countMatches, playersForMatches, recentMatches } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam) || 1)
  const total = countMatches()
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const matches = recentMatches(PAGE_SIZE, (page - 1) * PAGE_SIZE)
  const playersByMatch = playersForMatches(matches.map((m) => m.id))
  const me = await getMe()

  if (total === 0) return <Empty>还没有比赛数据。</Empty>

  return (
    <div className="grid gap-6">
      <SectionTitle title="全部比赛" hint={`共 ${total} 场`} />
      <MatchList matches={matches} playersByMatch={playersByMatch} perspective={me ?? undefined} />

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={`/matches?page=${page - 1}`} className="glass px-3 py-1.5 hover:shadow-md">
              上一页
            </Link>
          ) : null}
          <span className="num px-3 text-ink-400">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={`/matches?page=${page + 1}`} className="glass px-3 py-1.5 hover:shadow-md">
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
