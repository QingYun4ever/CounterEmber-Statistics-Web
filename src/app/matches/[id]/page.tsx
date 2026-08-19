import { notFound } from 'next/navigation'
import { Head } from '@/components/Avatar'
import Scoreboard from '@/components/Scoreboard'
import { Card, DerivedNote, PlayerLink, Pill, SectionTitle, TeamTag } from '@/components/ui'
import { fmtDate, fmtTime, ratio, SIDE_NAME } from '@/lib/format'
import { getMe } from '@/lib/me-server'
import { getMatch } from '@/lib/queries'
import type { Side } from '@/lib/protocol'

export const dynamic = 'force-dynamic'

const WINNER_LABEL: Record<string, string> = {
  CT: `${SIDE_NAME.CT} 获胜`,
  T: `${SIDE_NAME.T} 获胜`,
  DRAW: '双方平局',
  UNKNOWN: '结果未知',
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = getMatch(id)
  if (!data) notFound()
  const { match, players, rounds, kills } = data
  const me = await getMe()

  const killsByRound = new Map<number, typeof kills>()
  for (const k of kills) {
    const list = killsByRound.get(k.round_idx)
    if (list) list.push(k)
    else killsByRound.set(k.round_idx, [k])
  }

  const sideOf = new Map(players.map((p) => [p.player, p.team] as const))

  return (
    <div className="grid gap-8">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-baseline gap-3">
            <span className="num text-4xl font-semibold tracking-tight text-ct">{match.ct_score}</span>
            <span className="text-2xl text-ink-300">:</span>
            <span className="num text-4xl font-semibold tracking-tight text-t">{match.t_score}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-ink-900">{WINNER_LABEL[match.winner]}</div>
            <div className="mt-0.5 text-xs text-ink-400">
              {fmtDate(match.ended_at)} · {match.server} · 上报者 {match.uploader}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {match.mvp ? <Pill tone="gold">★ MVP {match.mvp}</Pill> : null}
            <Pill>{match.rounds_observed} 回合</Pill>
            {match.complete ? (
              <Pill tone="good">完整观测</Pill>
            ) : (
              <Pill tone="bad">部分观测</Pill>
            )}
          </div>
        </div>
        {!match.complete ? (
          <p className="mt-4 rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-amber-700">
            这场比赛只观测到部分回合（客户端中途加入或旁观）。上方结算数据仍是服务器给出的完整值，
            但比分与下方所有推断指标只覆盖已观测到的 {match.rounds_observed} 个回合。
          </p>
        ) : null}
      </Card>

      <section>
        <SectionTitle title="记分板" hint="按 Rating 排序" />
        <Scoreboard match={match} players={players} highlight={me ?? undefined} />
      </section>

      <section>
        <SectionTitle
          title="推断数据"
          hint="以下均由击杀播报重放得出，服务器并未直接给出"
          right={<DerivedNote rounds={match.rounds_observed} />}
        />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="py-2.5 pl-4 text-left font-medium">玩家</th>
                  <th className="px-3 text-right font-medium">首杀</th>
                  <th className="px-3 text-right font-medium">首死</th>
                  <th className="px-3 text-right font-medium">首杀转化</th>
                  <th className="px-3 text-right font-medium">2K</th>
                  <th className="px-3 text-right font-medium">3K</th>
                  <th className="px-3 text-right font-medium">4K</th>
                  <th className="px-3 text-right font-medium">5K</th>
                  <th className="px-3 text-right font-medium">残局</th>
                  <th className="px-3 text-right font-medium">补枪</th>
                  <th className="py-2.5 pr-4 text-right font-medium">存活</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr
                    key={p.player}
                    className={`border-t border-white/70 ${p.player === me ? 'bg-indigo-50/50' : ''}`}
                  >
                    <td className="py-2.5 pl-4">
                      <span className="flex items-center gap-2">
                        <Head name={p.player} size={22} />
                        <TeamTag side={p.team} />
                        <PlayerLink name={p.player} className="font-medium text-ink-900" />
                      </span>
                    </td>
                    <td className="num px-3 text-right text-ink-700">{p.opening_kills}</td>
                    <td className="num px-3 text-right text-ink-700">{p.opening_deaths}</td>
                    <td className="num px-3 text-right text-ink-500">
                      {p.opening_kills > 0 ? `${p.opening_wins}/${p.opening_kills}` : '—'}
                    </td>
                    <td className="num px-3 text-right text-ink-700">{p.mk2 || '—'}</td>
                    <td className="num px-3 text-right text-ink-700">{p.mk3 || '—'}</td>
                    <td className="num px-3 text-right text-ink-700">{p.mk4 || '—'}</td>
                    <td className="num px-3 text-right font-semibold text-violet">{p.mk5 || '—'}</td>
                    <td className="num px-3 text-right text-ink-700">
                      {p.clutch_attempts > 0 ? `${p.clutch_wins}/${p.clutch_attempts}` : '—'}
                    </td>
                    <td className="num px-3 text-right text-ink-700">{p.trade_kills || '—'}</td>
                    <td className="num py-2.5 pr-4 text-right text-ink-500">
                      {p.rounds_played > 0
                        ? `${Math.round(ratio(p.rounds_survived, p.rounds_played))}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle title="回合时间轴" hint={`共观测 ${rounds.length} 回合`} />
        <div className="grid gap-2.5">
          {rounds.map((round, i) => {
            const roundKills = killsByRound.get(round.idx) ?? []
            return (
              <Card key={round.idx} i={Math.min(i, 8)} soft className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="num w-9 text-xs font-semibold text-ink-400">
                    R{round.idx + 1}
                  </span>
                  <TeamTag side={round.winner} />
                  <span className="text-xs text-ink-500">{round.reason}</span>
                  {round.bomb_site ? <Pill tone="gold">炸弹 {round.bomb_site} 点</Pill> : null}
                  <span className="num ml-auto text-xs text-ink-300">
                    {roundKills.length} 次击杀
                  </span>
                </div>

                {roundKills.length > 0 ? (
                  <ul className="mt-2.5 grid gap-1 border-t border-white/70 pt-2.5">
                    {roundKills.map((k) => (
                      <li key={k.seq} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="num w-14 shrink-0 text-ink-300">{fmtTime(k.ts)}</span>
                        {k.killer ? (
                          <>
                            <TeamTag side={(k.killer_side ?? sideOf.get(k.killer) ?? 'CT') as Side} />
                            <PlayerLink name={k.killer} className="font-medium text-ink-900" />
                            <span className="text-ink-400">{k.weapon}</span>
                            <span className="text-ink-300">☠</span>
                          </>
                        ) : (
                          <span className="text-ink-400">意外死亡</span>
                        )}
                        <TeamTag side={(k.victim_side ?? sideOf.get(k.victim) ?? 'T') as Side} />
                        <span className="text-ink-500">{k.victim}</span>
                        {k.is_opening ? <Pill tone="ct">首杀</Pill> : null}
                        {k.is_trade ? <Pill tone="good">补枪</Pill> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
