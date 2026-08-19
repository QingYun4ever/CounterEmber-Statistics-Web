/**
 * Deletes matches whose numbers cannot have come from the game.
 *
 * Written after ~2800 fuzzed matches were pushed into the live database by something holding a
 * valid API key: rosters of CS pro nicknames with values like `60237-19-5052`, ADR 6200 and
 * Rating 44.56. The payloads passed validation because the schema only required the fields to be
 * non-negative, so nothing bounded them.
 *
 * The filter is deliberately about impossible *values* rather than "everything uploaded during
 * that hour": a time window would also take out any real match a player uploaded in the same
 * window, and it would not catch a second burst later.
 *
 * Thresholds sit far above anything this server has ever produced (real maxima, measured across
 * the genuine matches: 32 kills, ADR 240, Rating 3.82, 23 rounds), so a real match cannot trip
 * them by being unusually good.
 *
 *   npm run purge-junk              # report only, default
 *   npm run purge-junk -- --apply
 */
import { getDb } from '../src/lib/db'

const LIMITS = {
  rating: 5,
  adr: 400,
  kills: 60,
  deaths: 60,
  assists: 60,
  rounds: 40,
}

const apply = process.argv.includes('--apply')
const db = getDb()

interface Suspect {
  id: string
  ended_at: number
  created_at: number
  uploader: string
  rounds_observed: number
  ct_score: number
  t_score: number
  worst: string
}

const suspects = db
  .prepare(
    `SELECT m.id, m.ended_at, m.created_at, m.uploader, m.rounds_observed, m.ct_score, m.t_score,
            (SELECT p.player || ' ' || p.kills || '-' || p.deaths || '-' || p.assists ||
                    '  ADR ' || p.adr || '  Rating ' || p.rating
               FROM match_players p
              WHERE p.match_id = m.id
              ORDER BY p.rating DESC LIMIT 1) AS worst
       FROM matches m
      WHERE m.rounds_observed > @rounds
         OR EXISTS (
              SELECT 1 FROM match_players p
               WHERE p.match_id = m.id
                 AND (p.rating > @rating OR p.adr > @adr
                      OR p.kills > @kills OR p.deaths > @deaths OR p.assists > @assists))
      ORDER BY m.created_at`,
  )
  .all(LIMITS) as Suspect[]

const total = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n

if (suspects.length === 0) {
  console.log(`${total} 场比赛，没有发现异常数据。`)
  process.exit(0)
}

// Uploads arrive one at a time in normal use; a burst is itself a strong signal, so show it.
const byUploader = new Map<string, number>()
for (const s of suspects) byUploader.set(s.uploader, (byUploader.get(s.uploader) ?? 0) + 1)

console.log(`共 ${total} 场，其中 ${suspects.length} 场数值不可能：\n`)
console.log('按上报者:')
for (const [uploader, n] of [...byUploader].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${uploader}`)
}

const first = suspects[0]
const last = suspects[suspects.length - 1]
console.log(
  `\n写入时间: ${new Date(first.created_at).toLocaleString()} — ${new Date(last.created_at).toLocaleString()}`,
)

console.log('\n样本:')
for (const s of suspects.slice(0, 5)) {
  console.log(`  ${s.id}  ${s.ct_score}:${s.t_score}  ${s.rounds_observed} 回合  ${s.worst}`)
}
if (suspects.length > 5) console.log(`  ... 另外 ${suspects.length - 5} 场`)

console.log(`\n将保留 ${total - suspects.length} 场。`)

if (!apply) {
  console.log('\n这是预演。确认无误后加 --apply 实际删除。')
  process.exit(0)
}

const drop = db.prepare('DELETE FROM matches WHERE id = ?')
const run = db.transaction(() => {
  // match_players / rounds / kill_events / match_uploaders all cascade off matches.
  for (const s of suspects) drop.run(s.id)
})
run()

const left = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n
const players = (
  db.prepare('SELECT COUNT(DISTINCT player) AS n FROM match_players').get() as { n: number }
).n
console.log(`\n已删除 ${suspects.length} 场，剩余 ${left} 场 / ${players} 名玩家。`)
