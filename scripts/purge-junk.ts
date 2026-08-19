/**
 * Finds matches whose numbers cannot have come from the game and, when requested, lets an
 * operator choose which of those matches to delete.
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
 *   npm run purge-junk                    # report only, default
 *   npm run purge-junk -- --apply          # list suspects and interactively choose deletions
 *   npm run purge-junk -- --select         # same as --apply
 */
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { getDb } from '../src/lib/db'

const LIMITS = {
  rating: 5,
  adr: 400,
  kills: 60,
  deaths: 60,
  assists: 60,
  rounds: 40,
}

const interactive = process.argv.includes('--apply') || process.argv.includes('--select')
const db = getDb()

interface Suspect {
  id: string
  ended_at: number
  created_at: number
  uploader: string
  rounds_observed: number
  ct_score: number
  t_score: number
  worst: string | null
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

function printReport(): void {
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
    console.log(`  ${s.id}  ${s.ct_score}:${s.t_score}  ${s.rounds_observed} 回合  ${s.worst ?? '无玩家数据'}`)
  }
  if (suspects.length > 5) console.log(`  ... 另外 ${suspects.length - 5} 场`)

  console.log(`\n如果全部删除，将保留 ${total - suspects.length} 场。`)
}

function printSelectionList(): void {
  console.log('\n可选择删除的记录（编号从 1 开始）:')
  for (const [index, s] of suspects.entries()) {
    console.log(
      `  ${String(index + 1).padStart(4)}  ${s.id}  ${new Date(s.created_at).toLocaleString()}  ` +
        `${s.ct_score}:${s.t_score}  ${s.rounds_observed} 回合  ${s.uploader}  ${s.worst ?? '无玩家数据'}`,
    )
  }
}

function parseSelection(raw: string): number[] {
  const byId = new Map(suspects.map((s, index) => [s.id, index]))
  const selected = new Set<number>()
  const tokens = raw.split(/[\s,]+/).filter(Boolean)

  if (tokens.length === 0) throw new Error('没有输入任何编号或 ID。')

  for (const token of tokens) {
    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to > suspects.length || from > to) {
        throw new Error(`编号范围无效：${token}（有效范围是 1-${suspects.length}）。`)
      }
      for (let index = from; index <= to; index++) selected.add(index - 1)
      continue
    }

    if (/^\d+$/.test(token)) {
      const index = Number(token)
      if (index < 1 || index > suspects.length) {
        throw new Error(`编号无效：${token}（有效范围是 1-${suspects.length}）。`)
      }
      selected.add(index - 1)
      continue
    }

    const index = byId.get(token)
    if (index === undefined) throw new Error(`找不到记录编号或 ID：${token}`)
    selected.add(index)
  }

  return [...selected].sort((a, b) => a - b)
}

async function chooseSuspects(): Promise<Suspect[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('\n--apply/--select 需要在交互式终端中运行，为安全起见本次未删除任何数据。')
    console.error('请直接在终端运行：npm run purge-junk -- --select')
    return null
  }

  printSelectionList()
  const readline = createInterface({ input, output })

  try {
    while (true) {
      const answer = (await readline.question(
        '\n输入要删除的编号（如 1,3,5-7），也可以粘贴记录 ID；输入 q 取消：',
      )).trim()

      if (/^(q|quit|取消)$/i.test(answer)) return null

      try {
        const indexes = parseSelection(answer)
        const selected = indexes.map((index) => suspects[index])

        console.log(`\n已选择 ${selected.length} 场：`)
        for (const [index, s] of selected.map((s) => [suspects.indexOf(s), s] as const)) {
          console.log(
            `  ${index + 1}  ${s.id}  ${new Date(s.created_at).toLocaleString()}  ` +
              `${s.ct_score}:${s.t_score}  ${s.rounds_observed} 回合  ${s.uploader}`,
          )
        }

        const confirmation = (await readline.question('确认永久删除这些记录？请输入 DELETE：')).trim()
        if (confirmation !== 'DELETE') {
          console.log('未输入 DELETE，已取消删除。')
          return null
        }
        return selected
      } catch (error) {
        console.error(`选择无效：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    readline.close()
  }
}

if (suspects.length === 0) {
  console.log(`${total} 场比赛，没有发现异常数据。`)
} else {
  printReport()

  if (!interactive) {
    console.log('\n这是预演。确认具体记录后运行 --select 手动选择并删除。')
  } else {
    const selected = await chooseSuspects()
    if (selected && selected.length > 0) {
      const drop = db.prepare('DELETE FROM matches WHERE id = ?')
      const run = db.transaction((rows: Suspect[]) => {
        let deleted = 0
        // match_players / rounds / kill_events / match_uploaders all cascade off matches.
        for (const s of rows) deleted += drop.run(s.id).changes
        return deleted
      })
      const deleted = run(selected)

      const left = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n
      const players = (
        db.prepare('SELECT COUNT(DISTINCT player) AS n FROM match_players').get() as { n: number }
      ).n
      console.log(`\n已删除 ${deleted} 场，剩余 ${left} 场 / ${players} 名玩家。`)
    } else {
      console.log('\n未删除任何数据。')
    }
  }
}
