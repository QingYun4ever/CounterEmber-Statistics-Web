import { notFound } from 'next/navigation'
import { Body } from '@/components/Avatar'
import { RatingHistogram, RatingTrend } from '@/components/charts'
import MatchList from '@/components/MatchList'
import RatingHero from '@/components/RatingHero'
import SetMeButton from '@/components/SetMeButton'
import { Card, DerivedNote, Kpi, Pill, PlayerLink, Rating, SectionTitle } from '@/components/ui'
import { fmt1, fmt2, fmtDay, kd, pct, pct1, ratio } from '@/lib/format'
import { getMe } from '@/lib/me-server'
import {
  matchesForPlayer,
  playerAgg,
  playerClutches,
  playerHistory,
  playerRelations,
  playerSides,
  playersForMatches,
  playerWeapons,
} from '@/lib/queries'

export const dynamic = 'force-dynamic'

const BUCKETS = [
  { bucket: '<0.5', lo: 0, hi: 0.5, mid: 0.4 },
  { bucket: '0.5–1.0', lo: 0.5, hi: 1, mid: 0.75 },
  { bucket: '1.0–1.5', lo: 1, hi: 1.5, mid: 1.2 },
  { bucket: '1.5–2.0', lo: 1.5, hi: 2, mid: 1.7 },
  { bucket: '≥2.0', lo: 2, hi: Infinity, mid: 2.2 },
]

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold text-ink-900">{value}</div>
      {hint ? <div className="text-[11px] text-ink-300">{hint}</div> : null}
    </div>
  )
}

export default async function PlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = await params
  const name = decodeURIComponent(raw)

  const agg = playerAgg(name)
  if (!agg) notFound()

  const me = await getMe()

  const history = playerHistory(name, 30)
  const matches = matchesForPlayer(name, 15)
  const playersByMatch = playersForMatches(matches.map((m) => m.id))
  const weapons = playerWeapons(name)
  const clutches = playerClutches(name)
  const sides = playerSides(name)
  const relations = playerRelations(name)

  const trend = [...history]
    .reverse()
    .map((h) => ({
      label: fmtDay(h.ended_at),
      rating: h.rating,
      kda: `${h.kills}-${h.deaths}-${h.assists}`,
    }))

  const histogram = BUCKETS.map((b) => ({
    bucket: b.bucket,
    mid: b.mid,
    count: history.filter((h) => h.rating >= b.lo && h.rating < b.hi).length,
  }))

  const maxWeapon = Math.max(1, ...weapons.map((w) => w.kills))
  const clutchKeys = Object.keys(clutches).sort()
  const totalClutch = Object.values(clutches).reduce(
    (acc, [w, a]) => [acc[0] + w, acc[1] + a] as [number, number],
    [0, 0] as [number, number],
  )

  return (
    <div className="grid gap-9">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(19rem,24rem)]">
        <Card className="relative overflow-hidden p-6">
          {/* Same lighting trick as the podium: glow behind, contact shadow underneath. */}
          <div
            className="pointer-events-none absolute -left-6 bottom-0 h-56 w-56 blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(124,140,255,0.30), transparent 70%)' }}
            aria-hidden
          />
          <div className="relative flex items-end gap-6">
            <div className="relative flex shrink-0 items-end justify-center">
              <div
                className="absolute bottom-0 h-2.5 w-20 rounded-full blur-[6px]"
                style={{ background: 'rgba(31,38,135,0.16)' }}
                aria-hidden
              />
              <Body name={name} height={196} className="relative" />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-3xl font-semibold tracking-tight">{name}</h1>
              <p className="mt-2 text-sm text-ink-400">
                {agg.matches} 场 · {agg.rounds_played} 个观测回合
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {agg.mvps > 0 ? <Pill tone="gold">★ {agg.mvps} 次 MVP</Pill> : null}
                <Pill>
                  最高 {fmt2(Math.max(...history.map((h) => h.rating)))}
                </Pill>
                <Pill tone={agg.wins * 2 >= agg.matches ? 'good' : 'bad'}>
                  {agg.wins} 胜 {agg.matches - agg.wins} 负
                </Pill>
              </div>
              <div className="mt-4">
                <SetMeButton name={name} isMe={me === name} />
              </div>
            </div>
          </div>
        </Card>

        <RatingHero rating={agg.avg_rating} ratings={history.map((h) => h.rating)} />
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="KAST" value={pct(agg.avg_kast)} i={0} />
        <Kpi label="ADR" value={fmt1(agg.avg_adr)} i={1} />
        <Kpi
          label="K / D"
          value={kd(agg.kills, agg.deaths)}
          sub={`${agg.kills} / ${agg.deaths} / ${agg.assists}`}
          i={2}
        />
        <Kpi
          label="胜率"
          value={pct(ratio(agg.wins, agg.matches))}
          sub={`${agg.wins} 胜 ${agg.matches - agg.wins} 负`}
          i={3}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <SectionTitle title="Rating 走势" hint={`近 ${trend.length} 场，从旧到新`} />
          <RatingTrend data={trend} />
        </Card>
        <Card className="p-5" i={1}>
          <SectionTitle title="Rating 分布" />
          <RatingHistogram data={histogram} />
        </Card>
      </section>

      <section>
        <SectionTitle title="推断数据" right={<DerivedNote rounds={agg.rounds_played} />} />
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <div className="mb-3 text-[13px] font-semibold text-ink-900">开局枪战</div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="首杀" value={agg.opening_kills} />
              <Stat label="首死" value={agg.opening_deaths} />
              <Stat
                label="开局胜率"
                value={pct(ratio(agg.opening_kills, agg.opening_kills + agg.opening_deaths))}
                hint={`${agg.opening_kills}/${agg.opening_kills + agg.opening_deaths}`}
              />
            </div>
            <div className="mt-4 border-t border-white/70 pt-3">
              <Stat
                label="首杀转化为回合胜利"
                value={pct(ratio(agg.opening_wins, agg.opening_kills))}
                hint={`${agg.opening_wins}/${agg.opening_kills} 次首杀后本方拿下回合`}
              />
            </div>
          </Card>

          <Card className="p-5" i={1}>
            <div className="mb-3 text-[13px] font-semibold text-ink-900">多杀 & 补枪</div>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="2K" value={agg.mk2} />
              <Stat label="3K" value={agg.mk3} />
              <Stat label="4K" value={agg.mk4} />
              <Stat label="5K" value={<span className="text-violet">{agg.mk5}</span>} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/70 pt-3">
              <Stat label="补枪击杀" value={agg.trade_kills} />
              <Stat
                label="存活率"
                value={pct(ratio(agg.rounds_survived, agg.rounds_played))}
                hint={`${agg.rounds_survived}/${agg.rounds_played} 回合`}
              />
            </div>
          </Card>

          <Card className="p-5" i={2}>
            <div className="mb-3 text-[13px] font-semibold text-ink-900">残局</div>
            {clutchKeys.length === 0 ? (
              <p className="text-sm text-ink-400">还没有观测到残局。</p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  {clutchKeys.map((key) => {
                    const [wins, attempts] = clutches[key]
                    return (
                      <div key={key} className="flex items-center gap-3 text-sm">
                        <span className="num w-8 text-ink-500">{key}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/70">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${ratio(wins, attempts)}%`,
                              background: 'linear-gradient(90deg,#7c5cff,#b15cff)',
                            }}
                          />
                        </div>
                        <span className="num w-10 text-right text-xs text-ink-500">
                          {wins}/{attempts}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 border-t border-white/70 pt-3">
                  <Stat
                    label="总残局胜率"
                    value={pct(ratio(totalClutch[0], totalClutch[1]))}
                    hint={`${totalClutch[0]}/${totalClutch[1]}`}
                  />
                </div>
              </>
            )}
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="武器击杀分布" />
          {weapons.length === 0 ? (
            <p className="text-sm text-ink-400">暂无数据。</p>
          ) : (
            <div className="grid gap-2">
              {weapons.map((w) => (
                <div key={w.weapon} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate text-ink-700" title={w.weapon}>
                    {w.weapon}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/70">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(w.kills / maxWeapon) * 100}%`,
                        background: 'linear-gradient(90deg,#7c8cff,#4f7dff)',
                      }}
                    />
                  </div>
                  <span className="num w-8 text-right text-xs text-ink-500">{w.kills}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5" i={1}>
          <SectionTitle title="CT / T 分侧" />
          <div className="grid grid-cols-2 gap-4">
            {(['CT', 'T'] as const).map((side) => {
              const s = sides[side]
              return (
                <div key={side} className="rounded-xl border border-white/70 bg-white/45 p-4">
                  <div
                    className="mb-2 text-sm font-semibold"
                    style={{ color: side === 'CT' ? '#4f7dff' : '#f0a23c' }}
                  >
                    {side}
                  </div>
                  <div className="grid gap-2">
                    <Stat label="回合" value={s.rounds} />
                    <Stat label="击杀 / 死亡" value={`${s.kills} / ${s.deaths}`} />
                    <Stat
                      label="每回合击杀"
                      value={s.rounds ? (s.kills / s.rounds).toFixed(2) : '—'}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {(
          [
            ['常见队友', relations.teammates],
            ['常见对手', relations.opponents],
          ] as const
        ).map(([title, rows], idx) => (
          <Card key={title} className="p-5" i={idx}>
            <SectionTitle
              title={title}
              hint={title === '常见队友' ? '同队时本人的胜率' : '对位时本人的胜率'}
            />
            {rows.length === 0 ? (
              <p className="text-sm text-ink-400">暂无数据。</p>
            ) : (
              <div className="grid gap-1.5">
                {rows.slice(0, 8).map((r) => (
                  <div key={r.other} className="flex items-center gap-3 text-sm">
                    <PlayerLink name={r.other} className="w-32 shrink-0 truncate text-ink-700" />
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/70">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${ratio(r.wins, r.matches)}%`,
                          background:
                            r.wins * 2 >= r.matches
                              ? 'linear-gradient(90deg,#5ec99a,#2fa36b)'
                              : 'linear-gradient(90deg,#f19aa6,#e5566a)',
                        }}
                      />
                    </div>
                    <span className="num w-14 text-right text-xs text-ink-500">
                      {r.wins}/{r.matches}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </section>

      <section>
        <SectionTitle title="最近比赛" hint={`最新 ${matches.length} 场`} />
        <MatchList matches={matches} playersByMatch={playersByMatch} perspective={name} />
      </section>
    </div>
  )
}
