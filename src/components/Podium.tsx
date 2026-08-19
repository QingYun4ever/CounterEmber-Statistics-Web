import { fmt1, kd, pct } from '@/lib/format'
import type { PlayerAgg } from '@/lib/queries'
import { Body } from './Avatar'
import { PlayerLink, Rating } from './ui'

/** Gold / silver / bronze, toned down for the light background. */
const TIERS = [
  {
    ring: 'ring-amber-200/80',
    badge: 'bg-gradient-to-b from-amber-300 to-amber-500 text-white',
    card: 'bg-amber-50/55',
    glow: 'radial-gradient(circle, rgba(245,181,68,0.42), transparent 68%)',
    pedestal: 176,
    figure: 168,
  },
  {
    ring: 'ring-slate-200/80',
    badge: 'bg-gradient-to-b from-slate-300 to-slate-400 text-white',
    card: 'bg-white/55',
    glow: 'radial-gradient(circle, rgba(148,163,184,0.34), transparent 68%)',
    pedestal: 140,
    figure: 132,
  },
  {
    ring: 'ring-orange-200/80',
    badge: 'bg-gradient-to-b from-orange-300 to-orange-500 text-white',
    card: 'bg-orange-50/50',
    glow: 'radial-gradient(circle, rgba(201,139,82,0.32), transparent 68%)',
    pedestal: 118,
    figure: 124,
  },
]

function Crown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-5 w-5">
      <path d="M3 8l4.2 3.2L12 5l4.8 6.2L21 8l-1.6 10H4.6L3 8z" strokeLinejoin="round" />
    </svg>
  )
}

function Step({ player, rank }: { player: PlayerAgg; rank: number }) {
  const tier = TIERS[rank - 1]

  return (
    <div className="flex w-1/3 max-w-[13rem] flex-col items-center">
      {/* Figure, lit from below so it reads against the pale background. */}
      <div className="relative flex items-end justify-center" style={{ height: tier.figure + 12 }}>
        <div
          className="absolute bottom-1 h-24 w-24 rounded-full blur-2xl"
          style={{ background: tier.glow }}
        />
        <div
          className="absolute bottom-1 h-2.5 w-16 rounded-full blur-[6px]"
          style={{ background: 'rgba(31,38,135,0.16)' }}
        />
        <Body name={player.player} height={tier.figure} className="relative" />
      </div>

      {/* Pedestal */}
      <div
        className={`glass relative mt-3 flex w-full flex-col items-center rounded-b-none rounded-t-2xl px-3 pt-5 ring-1 ${tier.ring} ${tier.card}`}
        style={{ height: tier.pedestal }}
      >
        <span
          className={`num absolute -top-3.5 grid h-7 w-7 place-items-center rounded-full text-xs font-bold shadow-sm ${tier.badge}`}
        >
          {rank}
        </span>

        <PlayerLink
          name={player.player}
          className="max-w-full truncate text-sm font-semibold text-ink-900"
        />
        <Rating value={player.avg_rating} className="mt-1 text-xl" />
        <div className="num mt-1 text-[11px] text-ink-400">
          {player.matches} 场 · KAST {pct(player.avg_kast)}
        </div>
        <div className="num text-[11px] text-ink-400">
          ADR {fmt1(player.avg_adr)} · K/D {kd(player.kills, player.deaths)}
        </div>

        {/* Watermark */}
        <span
          className="num pointer-events-none absolute bottom-1 select-none text-[3.4rem] font-bold leading-none text-ink-900/[0.045]"
          aria-hidden
        >
          {rank}
        </span>
        {rank === 1 ? (
          <span className="pointer-events-none absolute bottom-3 text-amber-500/25" aria-hidden>
            <Crown />
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Top three, arranged 2 – 1 – 3 like a real podium. */
export default function Podium({ players }: { players: PlayerAgg[] }) {
  const top = players.slice(0, 3)
  if (top.length < 3) return null

  const order = [
    { player: top[1], rank: 2 },
    { player: top[0], rank: 1 },
    { player: top[2], rank: 3 },
  ]

  return (
    <div className="rise flex items-end justify-center gap-3 sm:gap-6">
      {order.map(({ player, rank }) => (
        <Step key={player.player} player={player} rank={rank} />
      ))}
    </div>
  )
}
