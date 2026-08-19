import type { CSSProperties } from 'react'
import { TEAM_NAME } from '@/lib/format'
import type { MatchPlayerRow, MatchRow } from '@/lib/queries'
import type { Side } from '@/lib/protocol'
import { Head } from './Avatar'
import { PlayerLink, Rating } from './ui'

/**
 * The MVP row is marked with background layers only — a star tucked into the top-left corner
 * plus a gold wash fading to the right. Keeping it in the background means the ornament sits
 * *behind* the avatar instead of crowding the name, and the row stays the same height as every
 * other one. The star is sized to the row height and bleeds off only the left edge, so it reads
 * as a whole star rather than a sliced one.
 */
const MVP_STAR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path fill="#e0a01c" fill-opacity=".52" d="M12 1.8 14.47 8.9 21.99 9.06 15.99 13.6' +
    ' 18.17 20.79 12 16.5 5.83 20.79 8.01 13.6 2.01 9.06 9.53 8.9Z"/></svg>',
)}")`

const MVP_ROW: CSSProperties = {
  backgroundImage: `${MVP_STAR}, linear-gradient(90deg, rgba(245,181,68,0.30) 0%, rgba(245,181,68,0.11) 38%, rgba(245,181,68,0) 82%)`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'left -10px top 1px, left top',
  backgroundSize: '36px 36px, 100% 100%',
}

function TeamBlock({
  side,
  score,
  players,
  isWinner,
  highlight,
}: {
  side: Side
  score: number
  players: MatchPlayerRow[]
  isWinner: boolean
  highlight?: string
}) {
  const maxRating = Math.max(1, ...players.map((p) => p.rating))
  const accent = side === 'CT' ? '#4f7dff' : '#f0a23c'

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2.5 px-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <span className="text-sm font-semibold text-ink-900">{TEAM_NAME[side]}</span>
        <span className="num ml-auto text-lg font-semibold" style={{ color: accent }}>
          {score}
        </span>
        {isWinner ? (
          <span className="text-[11px] font-medium text-emerald-600">胜</span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/70 bg-white/45">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-400">
              <th className="py-2 pl-3 text-left font-medium">玩家</th>
              <th className="px-2 text-right font-medium">K-D-A</th>
              <th className="px-2 text-right font-medium">+/−</th>
              <th className="px-2 text-right font-medium">ADR</th>
              <th className="px-2 text-right font-medium">KAST</th>
              <th className="py-2 pr-3 text-right font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const diff = p.kills - p.deaths
              return (
                <tr
                  key={p.player}
                  className={`border-t border-white/70 ${
                    highlight === p.player ? 'bg-indigo-50/50' : ''
                  }`}
                  style={p.is_mvp ? MVP_ROW : undefined}
                >
                  <td className="py-2 pl-3">
                    <span className="flex items-center gap-2">
                      <Head name={p.player} size={22} />
                      <PlayerLink name={p.player} className="font-medium text-ink-900" />
                      {p.is_mvp ? <span className="sr-only">本场 MVP</span> : null}
                    </span>
                  </td>
                  <td className="num px-2 text-right text-ink-700">
                    {p.kills}-{p.deaths}-{p.assists}
                  </td>
                  <td
                    className="num px-2 text-right"
                    style={{ color: diff > 0 ? '#2fa36b' : diff < 0 ? '#e5566a' : '#8a93a8' }}
                  >
                    {diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className="num px-2 text-right text-ink-700">{p.adr}</td>
                  <td className="num px-2 text-right text-ink-700">{p.kast}%</td>
                  <td className="py-2 pr-3 text-right">
                    <span className="relative inline-flex min-w-[3.4rem] justify-end">
                      <span
                        className="absolute inset-y-0 right-0 -z-10 rounded-md"
                        style={{
                          width: `${(p.rating / maxRating) * 100}%`,
                          background: 'linear-gradient(90deg, transparent, rgba(33,185,95,0.20))',
                        }}
                      />
                      <Rating value={p.rating} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Scoreboard({
  match,
  players,
  highlight,
}: {
  match: MatchRow
  players: MatchPlayerRow[]
  /** Your own row gets tinted. Identity comes from the cookie (see lib/me.ts). */
  highlight?: string
}) {
  const byTeam: Record<Side, MatchPlayerRow[]> = { CT: [], T: [] }
  for (const p of players) byTeam[p.team].push(p)

  // Winning side on top; falls back to CT-first for draws and unknown results.
  const order: Side[] = match.winner === 'T' ? ['T', 'CT'] : ['CT', 'T']
  const score: Record<Side, number> = { CT: match.ct_score, T: match.t_score }

  return (
    <div className="grid gap-6">
      {order.map((side) => (
        <TeamBlock
          key={side}
          side={side}
          score={score[side]}
          players={byTeam[side]}
          isWinner={match.winner === side}
          highlight={highlight}
        />
      ))}
      <p className="px-1 text-xs text-ink-400">
        K-D-A / ADR / KAST / Rating 由服务器结算表提供，未经二次计算。
      </p>
    </div>
  )
}
