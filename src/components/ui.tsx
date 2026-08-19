import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { fmt2, ratingStyle, SIDE_SHORT, TEAM_SHORT } from '@/lib/format'
import type { Side } from '@/lib/protocol'

export function Card({
  children,
  className = '',
  i = 0,
  soft = false,
}: {
  children: ReactNode
  className?: string
  i?: number
  soft?: boolean
}) {
  return (
    <section
      className={`${soft ? 'glass-soft' : 'glass'} rise ${className}`}
      style={{ '--i': i } as CSSProperties}
    >
      {children}
    </section>
  )
}

export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: string
  hint?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-ink-400">{hint}</p> : null}
      </div>
      {right}
    </div>
  )
}

export function Rating({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`num font-semibold ${className}`} style={ratingStyle(value)}>
      {fmt2(value)}
    </span>
  )
}

export function Kpi({
  label,
  value,
  sub,
  accent,
  i = 0,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: CSSProperties
  i?: number
}) {
  return (
    <Card i={i} className="p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">{label}</div>
      <div className="num mt-2 text-3xl font-semibold tracking-tight" style={accent}>
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-ink-500">{sub}</div> : null}
    </Card>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'gold' | 'ct' | 't'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/70 text-ink-500 border-white/80',
    good: 'bg-emerald-50/80 text-emerald-700 border-emerald-100',
    bad: 'bg-rose-50/80 text-rose-600 border-rose-100',
    gold: 'bg-amber-50/80 text-amber-700 border-amber-100',
    ct: 'bg-blue-50/80 text-blue-700 border-blue-100',
    t: 'bg-orange-50/80 text-orange-700 border-orange-100',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Which side a player was on in a single round. Sides swap at halftime; teams do not. */
export function TeamTag({ side }: { side: Side }) {
  return <Pill tone={side === 'CT' ? 'ct' : 't'}>{SIDE_SHORT[side]}</Pill>
}

/** Which team a player belonged to for the whole match. See TeamTag for the per-round side. */
export function TeamBadge({ side }: { side: Side }) {
  return <Pill tone={side === 'CT' ? 'ct' : 't'}>{TEAM_SHORT[side]}</Pill>
}

export function PlayerLink({ name, className = '' }: { name: string; className?: string }) {
  return (
    <Link
      href={`/players/${encodeURIComponent(name)}`}
      className={`decoration-ink-300 underline-offset-4 hover:underline ${className}`}
    >
      {name}
    </Link>
  )
}

/** Marks every block whose numbers we inferred from the kill feed rather than read off the server. */
export function DerivedNote({ rounds }: { rounds?: number }) {
  return (
    <p className="text-xs text-ink-400">
      本地推断{rounds !== undefined ? ` · 基于观测到的 ${rounds} 回合` : ''}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card className="p-10 text-center text-sm text-ink-400">
      {children}
    </Card>
  )
}
