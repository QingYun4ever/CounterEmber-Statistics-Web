/**
 * Replays a Minecraft latest.log through the same parser the mod uses and uploads every match
 * it finds to /api/ingest.
 *
 * This is a development / backfill tool, not a mod feature. It exists so the site can be built
 * against real data before the Java mod compiles, and it doubles as a second implementation to
 * cross-check the mod against.
 *
 *   npm run import-log -- --dry
 *   npm run import-log -- --file "D:/Minecraft/ce/latest.log" --url http://127.0.0.1:3000
 */
import fs from 'node:fs'
import { MatchTracker } from '../src/lib/parse'
import type { Match } from '../src/lib/protocol'

const RE_LOG_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\] \[[^\]]+\]: \[System\] \[CHAT\] (.*)$/
const RE_CONNECTING = /Connecting to ([^,]+), (\d+)/
const RE_USER = /Setting user: (\S+)/

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

const file = arg('file', 'D:/Minecraft/ce/latest.log')!
const baseUrl = arg('url', 'http://127.0.0.1:3100')!
const apiKey = arg('key', process.env.CESTATS_API_KEY ?? 'dev-key')!
const dry = hasFlag('dry')
const dumpDir = arg('dump')

const text = fs.readFileSync(file, 'utf8')
const lines = text.split(/\r?\n/)

// The log only carries wall-clock times, so anchor the last line to the file's mtime and walk
// backwards, adding a day every time the clock wraps past midnight.
const mtime = fs.statSync(file).mtime
let server = arg('server') ?? 'unknown'
let uploader = arg('uploader') ?? 'unknown'

type Entry = { secs: number; day: number; content: string }
const entries: Entry[] = []
let day = 0
let prevSecs = -1

for (const line of lines) {
  const conn = RE_CONNECTING.exec(line)
  if (conn && !arg('server')) server = conn[1]
  const user = RE_USER.exec(line)
  if (user && !arg('uploader')) uploader = user[1]

  const m = RE_LOG_LINE.exec(line)
  if (!m) continue
  const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  if (prevSecs >= 0 && secs < prevSecs) day++
  prevSecs = secs
  entries.push({ secs, day, content: m[4].replace(/\\r/g, '\r').replace(/\\n/g, '\n') })
}

const lastDay = entries.length ? entries[entries.length - 1].day : 0
const endOfLastDay = new Date(mtime.getFullYear(), mtime.getMonth(), mtime.getDate())

function tsOf(e: Entry): number {
  const d = new Date(endOfLastDay)
  d.setDate(d.getDate() - (lastDay - e.day))
  return d.getTime() + e.secs * 1000
}

const matches: (Match & { matchId: string })[] = []
const tracker = new MatchTracker({
  server,
  uploader,
  onMatch: (m) => matches.push(m),
})

for (const e of entries) tracker.accept(e.content, tsOf(e))

console.log(`log      ${file}`)
console.log(`server   ${server}`)
console.log(`uploader ${uploader}`)
console.log(`chat     ${entries.length} system messages`)
console.log(`matches  ${matches.length}\n`)

for (const m of matches) {
  const flag = m.complete ? '完整' : '部分观测'
  console.log(
    `── ${m.matchId}  ${new Date(m.endedAt).toLocaleString('zh-CN')}  ` +
      `CT ${m.ctScore}:${m.tScore} T  胜方=${m.winner}  ${m.roundsObserved} 回合  ${flag}`,
  )
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))
  console.log(
    `   ${pad('玩家', 18)}${pad('侧', 4)}${pad('K-D-A', 10)}${pad('ADR', 6)}${pad('KAST', 7)}` +
      `${pad('RTG', 7)}${pad('首杀/首死', 12)}${pad('多杀', 12)}${pad('残局', 10)}${pad('补枪', 6)}${pad('存活', 8)}`,
  )
  for (const p of [...m.players].sort((a, b) => b.rating - a.rating)) {
    const d = p.derived
    const clutch = Object.entries(d.clutches)
      .map(([k, [w, a]]) => `${k}:${w}/${a}`)
      .join(' ')
    console.log(
      `   ${pad((p.isMvp ? '★' : ' ') + p.name, 18)}${pad(p.team, 4)}` +
        `${pad(`${p.kills}-${p.deaths}-${p.assists}`, 10)}${pad(String(p.adr), 6)}` +
        `${pad(`${p.kast}%`, 7)}${pad(p.rating.toFixed(2), 7)}` +
        `${pad(`${d.openingKills}/${d.openingDeaths}`, 12)}` +
        `${pad(`2K:${d.mk2} 3K:${d.mk3} 4K:${d.mk4} 5K:${d.mk5}`, 12)}` +
        `${pad(clutch || '-', 10)}${pad(String(d.tradeKills), 6)}` +
        `${pad(`${d.roundsSurvived}/${d.roundsPlayed}`, 8)}`,
    )
  }
  console.log()
}

if (dumpDir) {
  fs.mkdirSync(dumpDir, { recursive: true })
  for (const m of matches) {
    const { matchId, ...payload } = m
    fs.writeFileSync(`${dumpDir}/${matchId}.json`, JSON.stringify(payload, null, 2), 'utf8')
  }
  console.log(`已导出 ${matches.length} 份载荷到 ${dumpDir}`)
}

if (dry) {
  console.log('--dry：未上传。')
  process.exit(0)
}

let ok = 0
for (const m of matches) {
  const { matchId: _ignored, ...payload } = m
  const res = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) {
    ok++
    console.log(`✓ ${json.matchId} ${json.status}`)
  } else {
    console.error(`✗ ${res.status} ${JSON.stringify(json)}`)
  }
}
console.log(`\n上传成功 ${ok}/${matches.length}`)
