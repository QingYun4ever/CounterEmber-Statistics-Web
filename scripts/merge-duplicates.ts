/**
 * Collapses matches that two different players reported as separate uploads.
 *
 * Needed once, for rows written before `merge_key` existed. `saveMatch` merges on the way in now,
 * so this is a backfill, not a maintenance job — but it is safe to re-run and will simply report
 * nothing to do.
 *
 * Grouping is by the server's own end-of-match table (see computeMergeKey): every client in a
 * game receives that broadcast verbatim, while `server` differs between them whenever the same
 * host answers to more than one name, which is exactly how the duplicates got in.
 *
 * The survivor is the row that witnessed the most of the kill feed; the others hand over their
 * uploader names and are deleted.
 *
 *   npm run merge-duplicates -- --dry     # report only, default
 *   npm run merge-duplicates -- --apply
 */
import { getDb, mergeKeyOf } from '../src/lib/db'

const apply = process.argv.includes('--apply')

const db = getDb()

interface Row {
  id: string
  ended_at: number
  kill_count: number
  rounds_observed: number
  ct_score: number
  t_score: number
  uploader: string
  merge_key: string | null
}

const rows = db
  .prepare('SELECT id, ended_at, kill_count, rounds_observed, ct_score, t_score, uploader, merge_key FROM matches')
  .all() as Row[]

// getDb() already backfilled merge_key; recompute defensively for anything it could not.
for (const row of rows) {
  if (!row.merge_key) row.merge_key = mergeKeyOf(db, row.id)
}

const groups = new Map<string, Row[]>()
for (const row of rows) {
  const list = groups.get(row.merge_key!)
  if (list) list.push(row)
  else groups.set(row.merge_key!, [row])
}

const duplicated = [...groups.values()].filter((g) => g.length > 1)

if (duplicated.length === 0) {
  console.log(`${rows.length} 场比赛，没有重复。`)
  process.exit(0)
}

const addUploader = db.prepare(
  'INSERT OR IGNORE INTO match_uploaders (match_id, uploader) VALUES (?, ?)',
)
const uploadersOf = db.prepare('SELECT uploader FROM match_uploaders WHERE match_id = ?')
const drop = db.prepare('DELETE FROM matches WHERE id = ?')

let merged = 0

for (const group of duplicated) {
  // Most of the kill feed wins; ties go to the earlier report so its links keep working.
  const sorted = [...group].sort(
    (a, b) => b.kill_count - a.kill_count || a.ended_at - b.ended_at,
  )
  const [keep, ...discard] = sorted

  console.log(`\n${keep.ct_score}:${keep.t_score} · ${new Date(keep.ended_at).toLocaleString()}`)
  console.log(`  保留 ${keep.id}  ${keep.rounds_observed} 回合 / ${keep.kill_count} 击杀  ${keep.uploader}`)
  for (const row of discard) {
    console.log(
      `  合并 ${row.id}  ${row.rounds_observed} 回合 / ${row.kill_count} 击杀  ${row.uploader}`,
    )
  }

  if (!apply) continue

  const run = db.transaction(() => {
    for (const row of discard) {
      for (const { uploader } of uploadersOf.all(row.id) as { uploader: string }[]) {
        addUploader.run(keep.id, uploader)
      }
      addUploader.run(keep.id, row.uploader)
      // Children go with it: match_players / rounds / kill_events / match_uploaders all cascade.
      drop.run(row.id)
    }
  })
  run()
  merged += discard.length
}

console.log()
if (apply) {
  console.log(`已合并 ${merged} 条重复记录，剩余 ${rows.length - merged} 场。`)
} else {
  const total = duplicated.reduce((n, g) => n + g.length - 1, 0)
  console.log(`共 ${duplicated.length} 组重复、${total} 条可合并。加 --apply 实际执行。`)
}
