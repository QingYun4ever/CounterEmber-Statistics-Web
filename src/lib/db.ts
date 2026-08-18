import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Match } from './protocol'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS matches (
  id              TEXT PRIMARY KEY,
  server          TEXT NOT NULL,
  uploader        TEXT NOT NULL,
  ended_at        INTEGER NOT NULL,
  winner          TEXT NOT NULL,
  mvp             TEXT,
  ct_score        INTEGER NOT NULL,
  t_score         INTEGER NOT NULL,
  rounds_observed INTEGER NOT NULL,
  complete        INTEGER NOT NULL,
  kill_count      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id        TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player          TEXT NOT NULL,
  team            TEXT NOT NULL,
  won             INTEGER NOT NULL,
  kills           INTEGER NOT NULL,
  deaths          INTEGER NOT NULL,
  assists         INTEGER NOT NULL,
  adr             INTEGER NOT NULL,
  kast            INTEGER NOT NULL,
  rating          REAL NOT NULL,
  is_mvp          INTEGER NOT NULL,
  opening_kills   INTEGER NOT NULL,
  opening_deaths  INTEGER NOT NULL,
  opening_wins    INTEGER NOT NULL,
  trade_kills     INTEGER NOT NULL,
  mk2 INTEGER NOT NULL, mk3 INTEGER NOT NULL, mk4 INTEGER NOT NULL, mk5 INTEGER NOT NULL,
  clutch_wins     INTEGER NOT NULL,
  clutch_attempts INTEGER NOT NULL,
  rounds_survived INTEGER NOT NULL,
  rounds_played   INTEGER NOT NULL,
  clutches_json   TEXT NOT NULL,
  weapons_json    TEXT NOT NULL,
  sides_json      TEXT NOT NULL,
  PRIMARY KEY (match_id, player)
);

CREATE TABLE IF NOT EXISTS rounds (
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  winner     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  bomb_site  TEXT,
  PRIMARY KEY (match_id, idx)
);

CREATE TABLE IF NOT EXISTS kill_events (
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  round_idx   INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  killer      TEXT,
  killer_side TEXT,
  weapon      TEXT,
  victim      TEXT NOT NULL,
  victim_side TEXT,
  is_opening  INTEGER NOT NULL,
  is_trade    INTEGER NOT NULL,
  PRIMARY KEY (match_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_matches_ended    ON matches(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_player        ON match_players(player);
CREATE INDEX IF NOT EXISTS idx_kill_match_round ON kill_events(match_id, round_idx, seq);
CREATE INDEX IF NOT EXISTS idx_kill_killer      ON kill_events(killer);
CREATE INDEX IF NOT EXISTS idx_kill_victim      ON kill_events(victim);
`

export type Db = Database.Database

const globalForDb = globalThis as unknown as { __cestatsDb?: Db }

export function getDb(): Db {
  if (globalForDb.__cestatsDb) return globalForDb.__cestatsDb

  const file = process.env.CESTATS_DB ?? path.join(process.cwd(), 'data', 'cestats.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  globalForDb.__cestatsDb = db
  return db
}

export type IngestResult = { matchId: string; status: 'created' | 'replaced' | 'duplicate' }

/**
 * Idempotent by match id. When the same match arrives again we only overwrite it if the new
 * upload saw more of the kill feed than the stored one — whoever watched more rounds wins.
 */
export function saveMatch(match: Match, matchId: string): IngestResult {
  const db = getDb()
  const killCount = match.rounds.reduce((n, r) => n + r.kills.length, 0)

  const existing = db.prepare('SELECT kill_count FROM matches WHERE id = ?').get(matchId) as
    | { kill_count: number }
    | undefined

  if (existing && existing.kill_count >= killCount) {
    return { matchId, status: 'duplicate' }
  }

  const write = db.transaction(() => {
    if (existing) {
      db.prepare('DELETE FROM kill_events WHERE match_id = ?').run(matchId)
      db.prepare('DELETE FROM rounds WHERE match_id = ?').run(matchId)
      db.prepare('DELETE FROM match_players WHERE match_id = ?').run(matchId)
      db.prepare('DELETE FROM matches WHERE id = ?').run(matchId)
    }

    db.prepare(
      `INSERT INTO matches (id, server, uploader, ended_at, winner, mvp, ct_score, t_score,
                            rounds_observed, complete, kill_count, created_at)
       VALUES (@id, @server, @uploader, @ended_at, @winner, @mvp, @ct_score, @t_score,
               @rounds_observed, @complete, @kill_count, @created_at)`,
    ).run({
      id: matchId,
      server: match.server,
      uploader: match.uploader,
      ended_at: match.endedAt,
      winner: match.winner,
      mvp: match.mvp,
      ct_score: match.ctScore,
      t_score: match.tScore,
      rounds_observed: match.roundsObserved,
      complete: match.complete ? 1 : 0,
      kill_count: killCount,
      created_at: Date.now(),
    })

    const insPlayer = db.prepare(
      `INSERT INTO match_players (match_id, player, team, won, kills, deaths, assists, adr, kast,
              rating, is_mvp, opening_kills, opening_deaths, opening_wins, trade_kills,
              mk2, mk3, mk4, mk5, clutch_wins, clutch_attempts, rounds_survived, rounds_played,
              clutches_json, weapons_json, sides_json)
       VALUES (@match_id, @player, @team, @won, @kills, @deaths, @assists, @adr, @kast,
              @rating, @is_mvp, @opening_kills, @opening_deaths, @opening_wins, @trade_kills,
              @mk2, @mk3, @mk4, @mk5, @clutch_wins, @clutch_attempts, @rounds_survived, @rounds_played,
              @clutches_json, @weapons_json, @sides_json)`,
    )

    for (const p of match.players) {
      const clutchValues = Object.values(p.derived.clutches)
      insPlayer.run({
        match_id: matchId,
        player: p.name,
        team: p.team,
        won: match.winner === 'DRAW' ? 0 : match.winner === p.team ? 1 : 0,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        adr: p.adr,
        kast: p.kast,
        rating: p.rating,
        is_mvp: p.isMvp ? 1 : 0,
        opening_kills: p.derived.openingKills,
        opening_deaths: p.derived.openingDeaths,
        opening_wins: p.derived.openingRoundWins,
        trade_kills: p.derived.tradeKills,
        mk2: p.derived.mk2,
        mk3: p.derived.mk3,
        mk4: p.derived.mk4,
        mk5: p.derived.mk5,
        clutch_wins: clutchValues.reduce((n, [w]) => n + w, 0),
        clutch_attempts: clutchValues.reduce((n, [, a]) => n + a, 0),
        rounds_survived: p.derived.roundsSurvived,
        rounds_played: p.derived.roundsPlayed,
        clutches_json: JSON.stringify(p.derived.clutches),
        weapons_json: JSON.stringify(p.derived.weapons),
        sides_json: JSON.stringify(p.derived.sides),
      })
    }

    const insRound = db.prepare(
      'INSERT INTO rounds (match_id, idx, winner, reason, bomb_site) VALUES (?, ?, ?, ?, ?)',
    )
    const insKill = db.prepare(
      `INSERT INTO kill_events (match_id, seq, round_idx, ts, killer, killer_side, weapon,
              victim, victim_side, is_opening, is_trade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const r of match.rounds) {
      insRound.run(matchId, r.idx, r.winner, r.reason, r.bombSite)
      for (const k of r.kills) {
        insKill.run(
          matchId,
          k.seq,
          r.idx,
          k.ts,
          k.killer,
          k.killerSide,
          k.weapon,
          k.victim,
          k.victimSide,
          k.isOpening ? 1 : 0,
          k.isTrade ? 1 : 0,
        )
      }
    }
  })

  write()
  return { matchId, status: existing ? 'replaced' : 'created' }
}
