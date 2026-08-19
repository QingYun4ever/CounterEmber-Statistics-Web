import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { computeMergeKey, type Match, type StatLine } from './protocol'

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

CREATE TABLE IF NOT EXISTS match_uploaders (
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  uploader  TEXT NOT NULL,
  PRIMARY KEY (match_id, uploader)
);

CREATE INDEX IF NOT EXISTS idx_matches_ended    ON matches(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_player        ON match_players(player);
CREATE INDEX IF NOT EXISTS idx_kill_match_round ON kill_events(match_id, round_idx, seq);
CREATE INDEX IF NOT EXISTS idx_kill_killer      ON kill_events(killer);
CREATE INDEX IF NOT EXISTS idx_kill_victim      ON kill_events(victim);
`

export type Db = Database.Database

const globalForDb = globalThis as unknown as { __cestatsDb?: Db }

/**
 * Additive migrations for databases created before a column existed.
 *
 * Non-destructive on purpose: this runs on every boot, so it may add columns, indexes and derived
 * rows, but it never merges or deletes matches. Collapsing existing duplicates is a separate,
 * explicit step — see scripts/merge-duplicates.ts.
 */
function migrate(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(matches)').all() as { name: string }[]

  if (!columns.some((c) => c.name === 'merge_key')) {
    db.exec('ALTER TABLE matches ADD COLUMN merge_key TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_matches_merge ON matches(merge_key)')

  // Backfill from the stored scoreboard, which is exactly what computeMergeKey hashes.
  const stale = db.prepare('SELECT id FROM matches WHERE merge_key IS NULL').all() as {
    id: string
  }[]
  if (stale.length > 0) {
    const setKey = db.prepare('UPDATE matches SET merge_key = ? WHERE id = ?')
    const fill = db.transaction(() => {
      for (const { id } of stale) setKey.run(mergeKeyOf(db, id), id)
    })
    fill()
  }

  // Every match has at least its original uploader; later uploads add themselves alongside.
  db.exec(
    `INSERT OR IGNORE INTO match_uploaders (match_id, uploader)
     SELECT id, uploader FROM matches`,
  )
}

/** Recomputes a stored match's merge key from its scoreboard rows. */
export function mergeKeyOf(db: Db, matchId: string): string {
  const rows = db
    .prepare(
      'SELECT player AS name, kills, deaths, assists, adr, kast, rating FROM match_players WHERE match_id = ?',
    )
    .all(matchId) as StatLine[]
  return computeMergeKey(rows)
}

export function getDb(): Db {
  if (globalForDb.__cestatsDb) return globalForDb.__cestatsDb

  const file = process.env.CESTATS_DB ?? path.join(process.cwd(), 'data', 'cestats.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)

  globalForDb.__cestatsDb = db
  return db
}

export type IngestResult = {
  matchId: string
  status: 'created' | 'replaced' | 'duplicate'
  /** Set when this upload was folded into a match some other player had already reported. */
  mergedInto?: string
  uploaders: string[]
}

/**
 * How far apart two uploads of "the same" scoreboard may sit before we stop believing it.
 *
 * The scoreboard hash is near-unique on its own, so this is only a guard against the pathological
 * case of an identical ten-player result recurring later. It is deliberately far wider than the
 * minute or two that separates two players uploading the same match, because a client that was
 * offline will flush its retry queue much later than that.
 */
const MERGE_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Idempotent by match id, and tolerant of the same match arriving under two different ids.
 *
 * Two players in one game produce identical scoreboards but can disagree on everything else —
 * the hostname they connected through, when their client finished uploading, and how much of the
 * kill feed they witnessed. So the row is located by `merge_key` (scoreboard only) rather than by
 * id, and whoever watched more of the kill feed supplies the stored data. Uploader names
 * accumulate instead of overwriting; the id of the first report is kept so existing links live.
 */
export function saveMatch(match: Match, matchId: string): IngestResult {
  const db = getDb()
  const killCount = match.rounds.reduce((n, r) => n + r.kills.length, 0)
  const mergeKey = computeMergeKey(match.players)

  const existing = db
    .prepare(
      `SELECT id, kill_count FROM matches
        WHERE (merge_key = @mergeKey AND ABS(ended_at - @endedAt) <= @window) OR id = @matchId
        ORDER BY id = @matchId DESC, kill_count DESC
        LIMIT 1`,
    )
    .get({ mergeKey, endedAt: match.endedAt, window: MERGE_WINDOW_MS, matchId }) as
    | { id: string; kill_count: number }
    | undefined

  // Keep the id the match was first stored under, so links already handed out keep working.
  const targetId = existing?.id ?? matchId
  const mergedInto = existing && existing.id !== matchId ? existing.id : undefined

  const addUploader = db.prepare(
    'INSERT OR IGNORE INTO match_uploaders (match_id, uploader) VALUES (?, ?)',
  )
  const uploadersOf = db.prepare(
    'SELECT uploader FROM match_uploaders WHERE match_id = ? ORDER BY uploader',
  )
  const listUploaders = () =>
    (uploadersOf.all(targetId) as { uploader: string }[]).map((r) => r.uploader)

  if (existing && existing.kill_count >= killCount) {
    // Nothing new to store, but this player still reported it.
    addUploader.run(targetId, match.uploader)
    return { matchId: targetId, status: 'duplicate', mergedInto, uploaders: listUploaders() }
  }

  const write = db.transaction(() => {
    // Survives the delete below, which would otherwise cascade the list away.
    const carried = existing ? listUploaders() : []

    if (existing) {
      db.prepare('DELETE FROM kill_events WHERE match_id = ?').run(targetId)
      db.prepare('DELETE FROM rounds WHERE match_id = ?').run(targetId)
      db.prepare('DELETE FROM match_players WHERE match_id = ?').run(targetId)
      db.prepare('DELETE FROM matches WHERE id = ?').run(targetId)
    }

    db.prepare(
      `INSERT INTO matches (id, server, uploader, ended_at, winner, mvp, ct_score, t_score,
                            rounds_observed, complete, kill_count, merge_key, created_at)
       VALUES (@id, @server, @uploader, @ended_at, @winner, @mvp, @ct_score, @t_score,
               @rounds_observed, @complete, @kill_count, @merge_key, @created_at)`,
    ).run({
      id: targetId,
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
      merge_key: mergeKey,
      created_at: Date.now(),
    })

    for (const name of carried) addUploader.run(targetId, name)
    addUploader.run(targetId, match.uploader)

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
        match_id: targetId,
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
      insRound.run(targetId, r.idx, r.winner, r.reason, r.bombSite)
      for (const k of r.kills) {
        insKill.run(
          targetId,
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
  return {
    matchId: targetId,
    status: existing ? 'replaced' : 'created',
    mergedInto,
    uploaders: listUploaders(),
  }
}
