/**
 * Lets an operator inspect all stored matches and manually delete selected records.
 *
 * The command name is kept as `purge-junk` for compatibility, but this tool no longer assumes
 * that a record is erroneous. It lists every match and only deletes the records explicitly chosen
 * by the operator.
 *
 *   npm run purge-junk                    # report only, default
 *   npm run purge-junk -- --select         # list all matches and interactively choose deletions
 *   npm run purge-junk -- --apply          # same as --select, kept for compatibility
 */
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { getDb } from '../src/lib/db'

const interactive = process.argv.includes('--apply') || process.argv.includes('--select')
const db = getDb()

interface MatchRow {
  id: string
  server: string
  uploader: string
  ended_at: number
  created_at: number
  winner: string
  ct_score: number
  t_score: number
  rounds_observed: number
  complete: number
  kill_count: number
  player_count: number
  top_player: string | null
}

const matches = db
  .prepare(
    `SELECT m.id, m.server, m.uploader, m.ended_at, m.created_at, m.winner,
            m.ct_score, m.t_score, m.rounds_observed, m.complete, m.kill_count,
            (SELECT COUNT(*) FROM match_players p WHERE p.match_id = m.id) AS player_count,
            (SELECT p.player || ' ' || p.kills || '-' || p.deaths || '-' || p.assists ||
                    '  ADR ' || p.adr || '  Rating ' || p.rating
               FROM match_players p
              WHERE p.match_id = m.id
              ORDER BY p.rating DESC LIMIT 1) AS top_player
       FROM matches m
      ORDER BY m.created_at`,
  )
  .all() as MatchRow[]

const total = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n

function dateOf(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '无时间'
}

function printReport(): void {
  console.log(`数据库中共有 ${total} 场比赛。`)
  if (matches.length !== total) {
    console.log(`当前读取到 ${matches.length} 场；数据可能在扫描期间发生了变化。`)
  }

  if (matches.length > 0) {
    console.log(`时间范围: ${dateOf(matches[0].created_at)} — ${dateOf(matches[matches.length - 1].created_at)}`)
    console.log('\n示例记录:')
    for (const match of matches.slice(0, 5)) {
      console.log(
        `  ${match.id}  ${dateOf(match.created_at)}  ${match.ct_score}:${match.t_score}  ` +
          `${match.rounds_observed} 回合 / ${match.kill_count} 击杀  ${match.uploader}`,
      )
    }
    if (matches.length > 5) console.log(`  ... 另外 ${matches.length - 5} 场`)
  }
}

function printSelectionList(): void {
  console.log(`\n全部比赛记录（共 ${matches.length} 场，编号按创建时间从早到晚）:`)
  for (const [index, match] of matches.entries()) {
    console.log(
      `  ${String(index + 1).padStart(4)}  ${match.id}  ${dateOf(match.created_at)}  ` +
        `${match.server}  ${match.ct_score}:${match.t_score}  ` +
        `${match.rounds_observed} 回合 / ${match.kill_count} 击杀 / ${match.player_count} 玩家  ` +
        `${match.uploader}  ${match.complete ? '完整' : '未完整'}  ` +
        `${match.top_player ?? ''}`,
    )
  }
}

function parseSelection(raw: string): number[] {
  const byId = new Map(matches.map((match, index) => [match.id, index]))
  const selected = new Set<number>()
  const tokens = raw.split(/[\s,，]+/).filter(Boolean)

  if (tokens.length === 0) throw new Error('没有输入任何编号或 ID。')

  for (const token of tokens) {
    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to > matches.length || from > to) {
        throw new Error(`编号范围无效：${token}（有效范围是 1-${matches.length}）。`)
      }
      for (let index = from; index <= to; index++) selected.add(index - 1)
      continue
    }

    if (/^\d+$/.test(token)) {
      const index = Number(token)
      if (index < 1 || index > matches.length) {
        throw new Error(`编号无效：${token}（有效范围是 1-${matches.length}）。`)
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

async function chooseMatches(): Promise<MatchRow[] | null> {
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
        const selected = indexes.map((index) => matches[index])

        console.log(`\n已选择 ${selected.length} 场：`)
        for (const index of indexes) {
          const match = matches[index]
          console.log(
            `  ${index + 1}  ${match.id}  ${dateOf(match.created_at)}  ` +
              `${match.ct_score}:${match.t_score}  ${match.rounds_observed} 回合  ${match.uploader}`,
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

if (matches.length === 0) {
  console.log('数据库中没有比赛记录。')
} else {
  printReport()

  if (!interactive) {
    console.log('\n这是预演。需要手动删除时运行 --select。')
  } else {
    const selected = await chooseMatches()
    if (selected && selected.length > 0) {
      const drop = db.prepare('DELETE FROM matches WHERE id = ?')
      const run = db.transaction((rows: MatchRow[]) => {
        let deleted = 0
        // match_players / rounds / kill_events / match_uploaders all cascade off matches.
        for (const match of rows) deleted += drop.run(match.id).changes
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
