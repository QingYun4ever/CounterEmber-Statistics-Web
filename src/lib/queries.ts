import { getDb } from './db'
import type { Side, Winner } from './protocol'

export interface MatchRow {
  id: string
  server: string
  uploader: string
  ended_at: number
  winner: Winner
  mvp: string | null
  ct_score: number
  t_score: number
  rounds_observed: number
  complete: number
}

export interface MatchPlayerRow {
  match_id: string
  player: string
  team: Side
  won: number
  kills: number
  deaths: number
  assists: number
  adr: number
  kast: number
  rating: number
  is_mvp: number
  opening_kills: number
  opening_deaths: number
  opening_wins: number
  trade_kills: number
  mk2: number
  mk3: number
  mk4: number
  mk5: number
  clutch_wins: number
  clutch_attempts: number
  rounds_survived: number
  rounds_played: number
  clutches_json: string
  weapons_json: string
  sides_json: string
}

export interface RoundRow {
  match_id: string
  idx: number
  winner: Side
  reason: string
  bomb_site: string | null
}

export interface KillRow {
  match_id: string
  seq: number
  round_idx: number
  ts: number
  killer: string | null
  killer_side: Side | null
  weapon: string | null
  victim: string
  victim_side: Side | null
  is_opening: number
  is_trade: number
}

export interface PlayerAgg {
  player: string
  matches: number
  avg_rating: number
  avg_kast: number
  avg_adr: number
  kills: number
  deaths: number
  assists: number
  wins: number
  mvps: number
  opening_kills: number
  opening_deaths: number
  opening_wins: number
  trade_kills: number
  mk2: number
  mk3: number
  mk4: number
  mk5: number
  clutch_wins: number
  clutch_attempts: number
  rounds_survived: number
  rounds_played: number
  last_played: number
}

const AGG_SELECT = `
  mp.player                AS player,
  COUNT(*)                 AS matches,
  AVG(mp.rating)           AS avg_rating,
  AVG(mp.kast)             AS avg_kast,
  AVG(mp.adr)              AS avg_adr,
  SUM(mp.kills)            AS kills,
  SUM(mp.deaths)           AS deaths,
  SUM(mp.assists)          AS assists,
  SUM(mp.won)              AS wins,
  SUM(mp.is_mvp)           AS mvps,
  SUM(mp.opening_kills)    AS opening_kills,
  SUM(mp.opening_deaths)   AS opening_deaths,
  SUM(mp.opening_wins)     AS opening_wins,
  SUM(mp.trade_kills)      AS trade_kills,
  SUM(mp.mk2)              AS mk2,
  SUM(mp.mk3)              AS mk3,
  SUM(mp.mk4)              AS mk4,
  SUM(mp.mk5)              AS mk5,
  SUM(mp.clutch_wins)      AS clutch_wins,
  SUM(mp.clutch_attempts)  AS clutch_attempts,
  SUM(mp.rounds_survived)  AS rounds_survived,
  SUM(mp.rounds_played)    AS rounds_played,
  MAX(m.ended_at)          AS last_played
`

export function overview() {
  const db = getDb()
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS matches,
              COALESCE(SUM(rounds_observed), 0) AS rounds,
              COALESCE(SUM(complete), 0) AS complete
       FROM matches`,
    )
    .get() as { matches: number; rounds: number; complete: number }
  const { players } = db
    .prepare('SELECT COUNT(DISTINCT player) AS players FROM match_players')
    .get() as { players: number }
  const { kills } = db.prepare('SELECT COUNT(*) AS kills FROM kill_events WHERE killer IS NOT NULL').get() as {
    kills: number
  }
  return { ...totals, players, kills }
}

export function recentMatches(limit = 20, offset = 0): MatchRow[] {
  return getDb()
    .prepare('SELECT * FROM matches ORDER BY ended_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as MatchRow[]
}

export function countMatches(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n
}

export function matchesForPlayer(player: string, limit = 20, offset = 0): MatchRow[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM matches m
       JOIN match_players mp ON mp.match_id = m.id AND mp.player = ?
       ORDER BY m.ended_at DESC LIMIT ? OFFSET ?`,
    )
    .all(player, limit, offset) as MatchRow[]
}

export function countMatchesForPlayer(player: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM match_players WHERE player = ?')
      .get(player) as { n: number }
  ).n
}

/** Player rows for a set of matches, so a list can show its scoreboards without N+1 queries. */
export function playersForMatches(ids: string[]): Map<string, MatchPlayerRow[]> {
  const out = new Map<string, MatchPlayerRow[]>()
  if (ids.length === 0) return out
  const placeholders = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT * FROM match_players WHERE match_id IN (${placeholders}) ORDER BY rating DESC`,
    )
    .all(...ids) as MatchPlayerRow[]
  for (const r of rows) {
    const list = out.get(r.match_id)
    if (list) list.push(r)
    else out.set(r.match_id, [r])
  }
  return out
}

export function getMatch(id: string) {
  const db = getDb()
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as MatchRow | undefined
  if (!match) return null
  const players = db
    .prepare('SELECT * FROM match_players WHERE match_id = ? ORDER BY rating DESC')
    .all(id) as MatchPlayerRow[]
  const rounds = db
    .prepare('SELECT * FROM rounds WHERE match_id = ? ORDER BY idx')
    .all(id) as RoundRow[]
  const kills = db
    .prepare('SELECT * FROM kill_events WHERE match_id = ? ORDER BY seq')
    .all(id) as KillRow[]
  return { match, players, rounds, kills }
}

export function leaderboard(minMatches = 1): PlayerAgg[] {
  return getDb()
    .prepare(
      `SELECT ${AGG_SELECT}
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       GROUP BY mp.player
       HAVING COUNT(*) >= ?
       ORDER BY avg_rating DESC`,
    )
    .all(minMatches) as PlayerAgg[]
}

export function playerAgg(player: string): PlayerAgg | null {
  return (
    (getDb()
      .prepare(
        `SELECT ${AGG_SELECT}
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player = ?
         GROUP BY mp.player`,
      )
      .get(player) as PlayerAgg | undefined) ?? null
  )
}

/** Per-match rows for a player, oldest first — used for the rating trend line. */
export function playerHistory(player: string, limit = 30) {
  return getDb()
    .prepare(
      `SELECT mp.*, m.ended_at, m.winner AS match_winner, m.complete
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player = ?
       ORDER BY m.ended_at DESC LIMIT ?`,
    )
    .all(player, limit) as (MatchPlayerRow & {
    ended_at: number
    match_winner: Winner
    complete: number
  })[]
}

export function playerWeapons(player: string, limit = 8) {
  return getDb()
    .prepare(
      `SELECT weapon, COUNT(*) AS kills
       FROM kill_events
       WHERE killer = ? AND weapon IS NOT NULL
       GROUP BY weapon ORDER BY kills DESC LIMIT ?`,
    )
    .all(player, limit) as { weapon: string; kills: number }[]
}

/** Clutch buckets ("1v1" .. "1v5") summed across every match the player appears in. */
export function playerClutches(player: string): Record<string, [number, number]> {
  const rows = getDb()
    .prepare('SELECT clutches_json FROM match_players WHERE player = ?')
    .all(player) as { clutches_json: string }[]
  const out: Record<string, [number, number]> = {}
  for (const row of rows) {
    const parsed = JSON.parse(row.clutches_json) as Record<string, [number, number]>
    for (const [key, [w, a]] of Object.entries(parsed)) {
      const cur = out[key] ?? [0, 0]
      out[key] = [cur[0] + w, cur[1] + a]
    }
  }
  return out
}

export function playerSides(player: string): Record<Side, { kills: number; deaths: number; rounds: number }> {
  const rows = getDb()
    .prepare('SELECT sides_json FROM match_players WHERE player = ?')
    .all(player) as { sides_json: string }[]
  const out = {
    CT: { kills: 0, deaths: 0, rounds: 0 },
    T: { kills: 0, deaths: 0, rounds: 0 },
  }
  for (const row of rows) {
    const parsed = JSON.parse(row.sides_json) as Partial<
      Record<Side, { kills: number; deaths: number; rounds: number }>
    >
    for (const side of ['CT', 'T'] as const) {
      const s = parsed[side]
      if (!s) continue
      out[side].kills += s.kills
      out[side].deaths += s.deaths
      out[side].rounds += s.rounds
    }
  }
  return out
}

/** Who this player wins with, and who they lose to. */
export function playerRelations(player: string) {
  const rows = getDb()
    .prepare(
      `SELECT other.player       AS other,
              me.team = other.team AS same_team,
              COUNT(*)           AS matches,
              SUM(me.won)        AS wins
       FROM match_players me
       JOIN match_players other ON other.match_id = me.match_id AND other.player <> me.player
       WHERE me.player = ?
       GROUP BY other.player, same_team
       ORDER BY matches DESC`,
    )
    .all(player) as { other: string; same_team: number; matches: number; wins: number }[]
  return {
    teammates: rows.filter((r) => r.same_team === 1),
    opponents: rows.filter((r) => r.same_team === 0),
  }
}

export function allPlayerNames(): string[] {
  return (
    getDb().prepare('SELECT DISTINCT player FROM match_players ORDER BY player').all() as {
      player: string
    }[]
  ).map((r) => r.player)
}
