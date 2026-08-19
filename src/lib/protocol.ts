import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Wire protocol between the Fabric mod and this site.
 *
 * The Java mod produces exactly this JSON shape; `scripts/import-log.ts` produces it too,
 * from the same raw chat lines. Both must agree field-for-field — that cross-check is the
 * main defence against a regex drifting on one side.
 */

export const SIDE = ['CT', 'T'] as const
export type Side = (typeof SIDE)[number]

export const WINNER = ['CT', 'T', 'DRAW', 'UNKNOWN'] as const
export type Winner = (typeof WINNER)[number]

/** Round end reasons the server broadcasts, verified against latest.log. */
export const ROUND_REASONS = ['全员淘汰', '炸弹爆炸', '炸弹拆除', '时间耗尽'] as const

export const zKillEvent = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  /** null for a non-kill death (fall damage / void), which the server reports as "<name> 死亡". */
  killer: z.string().nullable(),
  killerSide: z.enum(SIDE).nullable(),
  weapon: z.string().nullable(),
  victim: z.string(),
  victimSide: z.enum(SIDE).nullable(),
  isOpening: z.boolean(),
  isTrade: z.boolean(),
})
export type KillEvent = z.infer<typeof zKillEvent>

export const zRound = z.object({
  idx: z.number().int().nonnegative(),
  winner: z.enum(SIDE),
  reason: z.string(),
  bombSite: z.string().nullable(),
  kills: z.array(zKillEvent),
})
export type Round = z.infer<typeof zRound>

/** Everything below `derived` is inferred locally from the kill feed, not reported by the server. */
export const zDerived = z.object({
  openingKills: z.number().int().nonnegative(),
  openingDeaths: z.number().int().nonnegative(),
  openingRoundWins: z.number().int().nonnegative(),
  tradeKills: z.number().int().nonnegative(),
  mk2: z.number().int().nonnegative(),
  mk3: z.number().int().nonnegative(),
  mk4: z.number().int().nonnegative(),
  mk5: z.number().int().nonnegative(),
  /** "1v1" | "1v2" ... -> [wins, attempts] */
  clutches: z.record(z.tuple([z.number().int(), z.number().int()])),
  roundsSurvived: z.number().int().nonnegative(),
  roundsPlayed: z.number().int().nonnegative(),
  /** weapon name -> kills */
  weapons: z.record(z.number().int().nonnegative()),
  /** side -> per-side splits */
  sides: z.record(
    z.object({
      kills: z.number().int().nonnegative(),
      deaths: z.number().int().nonnegative(),
      rounds: z.number().int().nonnegative(),
    }),
  ),
})
export type Derived = z.infer<typeof zDerived>

/** kills/deaths/assists/adr/kast/rating come straight from the server's end-of-match table. */
export const zPlayer = z.object({
  name: z.string().min(1).max(32),
  team: z.enum(SIDE),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  adr: z.number().int().nonnegative(),
  kast: z.number().int().min(0).max(100),
  rating: z.number().nonnegative(),
  isMvp: z.boolean(),
  derived: zDerived,
})
export type Player = z.infer<typeof zPlayer>

export const zMatch = z.object({
  version: z.literal(1),
  server: z.string().min(1).max(120),
  uploader: z.string().min(1).max(32),
  endedAt: z.number().int().positive(),
  winner: z.enum(WINNER),
  mvp: z.string().nullable(),
  ctScore: z.number().int().nonnegative(),
  tScore: z.number().int().nonnegative(),
  roundsObserved: z.number().int().nonnegative(),
  /** true when observed kill-feed entries == sum of kills in the server table. */
  complete: z.boolean(),
  players: z.array(zPlayer).min(1).max(20),
  rounds: z.array(zRound).max(60),
})
export type Match = z.infer<typeof zMatch>

/** The part of the identity both clients always agree on: the server's own end-of-match table. */
export type StatLine = Pick<
  Player,
  'name' | 'kills' | 'deaths' | 'assists' | 'adr' | 'kast' | 'rating'
>

function statLines(players: StatLine[]): string {
  return players
    .map((p) => `${p.name}:${p.kills}-${p.deaths}-${p.assists}:${p.adr}:${p.kast}:${p.rating.toFixed(2)}`)
    .sort()
    .join(',')
}

/**
 * Deliberately timestamp-free: two clients that watched the same match must derive the same id
 * so the server can dedupe them. The roster plus every exact stat value is unique in practice.
 */
export function computeMatchId(match: Pick<Match, 'server' | 'players'>): string {
  return createHash('sha256')
    .update(`${match.server}|${statLines(match.players)}`, 'utf8')
    .digest('hex')
    .slice(0, 16)
}

/**
 * Identity for merging, as opposed to `computeMatchId`'s identity for storage.
 *
 * The difference is `server`, and it matters: the same physical server answers to more than one
 * hostname (`on.imc.cab` and `on.s.imc.re` were both seen for one match), so two players in the
 * same game can report different `server` strings and land on different match ids. Everything
 * else here comes from a single broadcast that every client receives verbatim, which makes the
 * scoreboard a far stronger merge signal than "uploaded around the same time with a similar
 * round count" — those are consequences of being the same match, not evidence of it.
 */
export function computeMergeKey(players: StatLine[]): string {
  return createHash('sha256').update(statLines(players), 'utf8').digest('hex').slice(0, 16)
}
