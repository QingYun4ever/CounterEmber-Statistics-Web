import { fmt2 } from '@/lib/format'
import { Card } from './ui'

/**
 * Rating bands. Widths are proportional to their share of a 0–2.0 scale so the marker's
 * position on the bar is honest rather than decorative.
 */
const SCALE_MAX = 2.0

const BANDS = [
  { label: '挣扎', from: 0, to: 0.85, color: '#e5566a' },
  { label: '稳定', from: 0.85, to: 1.15, color: '#8a93a8' },
  { label: '出色', from: 1.15, to: 1.5, color: '#4f7dff' },
  { label: '统治级', from: 1.5, to: SCALE_MAX, color: '#9f5cff' },
]

function bandOf(rating: number) {
  return BANDS.find((b) => rating < b.to) ?? BANDS[BANDS.length - 1]
}

export default function RatingHero({
  rating,
  ratings,
}: {
  rating: number
  /** Per-match ratings, used for the band distribution. */
  ratings: number[]
}) {
  const band = bandOf(rating)
  const pos = Math.min(100, Math.max(0, (rating / SCALE_MAX) * 100))
  const counts = BANDS.map((b) => ratings.filter((r) => r >= b.from && r < b.to).length)
  const total = Math.max(1, ratings.length)

  return (
    <Card className="relative overflow-hidden p-6">
      {/* Bottom glow: a wide spectral wash plus a brighter blob sitting under the marker. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40" aria-hidden>
        <div
          className="absolute inset-x-0 bottom-0 h-28 opacity-45 blur-3xl"
          style={{
            background:
              'linear-gradient(90deg, rgba(229,86,106,.55), rgba(245,181,68,.45), rgba(79,125,255,.55), rgba(159,92,255,.55))',
          }}
        />
        <div
          className="absolute bottom-0 h-24 w-40 -translate-x-1/2 opacity-70 blur-3xl"
          style={{ left: `${pos}%`, background: `radial-gradient(circle, ${band.color}, transparent 70%)` }}
        />
      </div>

      <div className="relative">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">
            Avg Rating
          </span>
          <span className="text-[11px] text-ink-400">{ratings.length} 场</span>
        </div>

        <div className="mt-2 flex items-end gap-3">
          <span
            className="num text-6xl font-semibold leading-none tracking-tight"
            style={
              rating > 1.5
                ? {
                    backgroundImage: 'linear-gradient(92deg, #7c5cff, #b15cff)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }
                : { color: band.color }
            }
          >
            {fmt2(rating)}
          </span>
          <span className="mb-1.5 text-sm font-medium" style={{ color: band.color }}>
            {band.label}
          </span>
        </div>

        {/* Scale */}
        <div className="relative mt-6">
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            {BANDS.map((b) => (
              <div
                key={b.label}
                className="h-full rounded-full"
                style={{
                  width: `${((b.to - b.from) / SCALE_MAX) * 100}%`,
                  background: b.color,
                  opacity: b === band ? 0.95 : 0.32,
                }}
              />
            ))}
          </div>
          <div
            className="absolute -top-1 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{ left: `${pos}%`, boxShadow: `0 0 0 3px ${band.color}55, 0 2px 6px rgba(31,38,135,.2)` }}
          >
            <span className="block h-full w-full rounded-full" style={{ background: band.color }} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {BANDS.map((b, i) => (
            <div key={b.label}>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
                <span className="text-[11px] text-ink-500">{b.label}</span>
              </div>
              <div className="num mt-0.5 text-sm font-medium text-ink-900">
                {counts[i]}
                <span className="ml-1 text-[11px] font-normal text-ink-300">
                  {Math.round((counts[i] / total) * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
