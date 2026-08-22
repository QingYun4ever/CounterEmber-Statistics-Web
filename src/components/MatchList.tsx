import Link from 'next/link'
import { fmtDate, relative, TEAM_NAME } from '@/lib/format'
import type { MatchPlayerRow, MatchRow } from '@/lib/queries'
import { Head } from './Avatar'
import { Card, Pill, Rating } from './ui'

const WINNER_SHORT: Record<string, string> = {
  CT: TEAM_NAME.CT,
  T: TEAM_NAME.T,
  DRAW: '平局',
  UNKNOWN: '未知',
}

export default function MatchList({
  matches,
  playersByMatch,
  perspective,
}: {
  matches: MatchRow[]
  playersByMatch: Map<string, MatchPlayerRow[]>
  /** When set, the row is framed from this player's point of view (win/loss + their line). */
  perspective?: string
}) {
  return (
    <div className="grid gap-2.5">
      {matches.map((match, i) => {
        const players = playersByMatch.get(match.id) ?? []
        const me = perspective ? players.find((p) => p.player === perspective) : undefined
        const top = players.slice(0, 3)
        // A partial match's score only covers the rounds we saw, so it is greyed out and
        // labelled rather than presented as the final result.
        const partial = !match.complete

        return (
          <Link key={match.id} href={`/matches/${match.id}`} className="block">
            <Card i={Math.min(i, 10)} className="px-5 py-4 transition-shadow hover:shadow-lg">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {me ? (
                  <span
                    className="h-9 w-1 shrink-0 rounded-full"
                    style={{
                      background:
                        match.winner === 'DRAW'
                          ? '#c3cadb'
                          : me.won
                            ? '#2fa36b'
                            : '#e5566a',
                    }}
                  />
                ) : null}

                <div className="flex items-baseline gap-2">
                  <span
                    className={`num text-xl font-semibold ${partial ? 'text-ink-400' : 'text-ct'}`}
                  >
                    {match.ct_score}
                  </span>
                  <span className="text-ink-300">:</span>
                  <span
                    className={`num text-xl font-semibold ${partial ? 'text-ink-400' : 'text-t'}`}
                  >
                    {match.t_score}
                  </span>
                  {partial ? (
                    <span className="num text-[11px] text-ink-400">
                      仅 {match.rounds_observed} 回合
                    </span>
                  ) : null}
                </div>

                <div className="min-w-[8rem]">
                  <div className="text-sm font-medium text-ink-900">
                    {me ? (
                      <>
                        {match.winner === 'DRAW' ? '平局' : me.won ? '胜利' : '失败'}
                        <span className="ml-2 text-xs font-normal text-ink-400">
                          {TEAM_NAME[me.team]}
                        </span>
                      </>
                    ) : match.winner === 'DRAW' ? (
                      '平局'
                    ) : (
                      `${WINNER_SHORT[match.winner]} 获胜`
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-400" title={fmtDate(match.ended_at)}>
                    {relative(match.ended_at)}
                    {partial ? '' : ` · ${match.rounds_observed} 回合`}
                  </div>
                </div>

                {me ? (
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="num text-sm font-medium text-ink-900">
                        {me.kills}-{me.deaths}-{me.assists}
                      </div>
                      <div className="text-[11px] text-ink-400">K-D-A</div>
                    </div>
                    <div>
                      <div className="num text-sm font-medium text-ink-900">{me.adr}</div>
                      <div className="text-[11px] text-ink-400">ADR</div>
                    </div>
                    <div>
                      <div className="num text-sm font-medium text-ink-900">{me.kast}%</div>
                      <div className="text-[11px] text-ink-400">KAST</div>
                    </div>
                    <div>
                      <Rating value={me.rating} className="text-base" />
                      <div className="text-[11px] text-ink-400">Rating</div>
                    </div>
                  </div>
                ) : (
                  <div className="hidden items-center gap-4 sm:flex">
                    {top.map((p) => (
                      <div key={p.player} className="flex items-center gap-1.5 text-xs">
                        <Head name={p.player} size={20} />
                        <div>
                          <div className="font-medium text-ink-700">{p.player}</div>
                          <Rating value={p.rating} className="text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {partial ? <Pill tone="bad">部分观测</Pill> : null}
                  {!me && match.mvp ? <Pill tone="gold">MVP {match.mvp}</Pill> : null}
                </div>
              </div>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
