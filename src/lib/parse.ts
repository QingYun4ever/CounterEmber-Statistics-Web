import type { Derived, KillEvent, Match, Round, Side, Winner } from './protocol'
import { computeMatchId } from './protocol'

/**
 * Chat parsing for the IMC.RE "团队爆破" (CS2-alike) game mode.
 *
 * Every regex here was verified line-by-line against a real latest.log. Two shapes matter:
 *  - player names never contain spaces, but WEAPON names do ("FN 冲锋枪"), so a kill line is
 *    read as: first token = killer, last token = victim, everything between = weapon;
 *  - the end-of-match table arrives as ONE chat message with embedded newlines.
 *
 * This module is intentionally free of any Next.js / DOM / Node dependency (other than the
 * crypto import in protocol.ts) so the Java mod can mirror it 1:1.
 */

export const TEAM_CT = '反恐精英'
export const TEAM_T = '恐怖分子'

/**
 * Biggest roster a single side has ever shown in a stats table. Used as a sanity gate: if a
 * round's replay puts more than this on one side, our side assignment drifted (someone who
 * left is still being counted) and the clutch numbers for that round can't be trusted.
 */
export const MAX_TEAM_SIZE = 5

/** A kill is only counted as a trade if it lands within this window after the teammate died. */
export const TRADE_WINDOW_MS = 5000

/** How long to wait for the "比赛结束！" line that normally follows the stats table. */
export const RESULT_TIMEOUT_MS = 5000

/**
 * Backstop for a missing match-start marker: this long without a single combat message means
 * whatever we buffered belongs to an older match. Real matches here run a round every 1-2 min,
 * and the longest observed within-match gap was 6.6 min.
 */
export const CONTEXT_GAP_MS = 10 * 60 * 1000

export const RE_KILL = /^\[(CT|T)\] (\S+) (.+?) ☠ \[(CT|T)\] (\S+)$/
export const RE_DEATH = /^(\S+) 死亡$/
export const RE_ROUND_END = /^回合结束！(反恐精英|恐怖分子) 获胜（(.+)）$/
export const RE_BOMB = /^炸弹已安放在 ([AB]) 点$/
export const RE_RESULT = /^比赛结束！(?:(反恐精英|恐怖分子) 赢得比赛！|双方平局！)$/
export const RE_STAT_LINE =
  /^(★\s+)?(\S+)\s+K-D-A\s+(\d+)-(\d+)-(\d+)\s+ADR\s+(\d+)\s+KAST\s+(\d+)%\s+Rating\s+([\d.]+)$/

/** Markers that mean "you are now somewhere new" — everything buffered belongs to an older match. */
export const RE_LOBBY = /^(\S+) 加入了大厅$/
export const RE_QUEUE = /^你已加入匹配队列$/
export const RE_ROOM = /^你已加入房间。$/

export function teamToSide(team: string): Side {
  return team === TEAM_CT ? 'CT' : 'T'
}

export function sideLabel(side: Side): string {
  return side === 'CT' ? TEAM_CT : TEAM_T
}

export interface StatLine {
  name: string
  team: Side
  isMvp: boolean
  kills: number
  deaths: number
  assists: number
  adr: number
  kast: number
  rating: number
}

export type ChatEvent =
  | { kind: 'kill'; killer: string; killerSide: Side; weapon: string; victim: string; victimSide: Side }
  | { kind: 'death'; victim: string }
  | { kind: 'roundEnd'; winner: Side; reason: string }
  | { kind: 'bomb'; site: string }
  | { kind: 'result'; winner: Winner }
  | { kind: 'stats'; players: StatLine[] }
  | { kind: 'contextReset'; why: string }

/** Parses the end-of-match table. Returns null when the message is not that table. */
export function parseStatsBlock(content: string): StatLine[] | null {
  if (!content.includes('比赛数据统计')) return null
  const players: StatLine[] = []
  let team: Side | null = null
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line === TEAM_CT) {
      team = 'CT'
      continue
    }
    if (line === TEAM_T) {
      team = 'T'
      continue
    }
    if (team === null) continue
    const m = RE_STAT_LINE.exec(line)
    if (!m) continue
    players.push({
      name: m[2],
      team,
      isMvp: m[1] !== undefined,
      kills: Number(m[3]),
      deaths: Number(m[4]),
      assists: Number(m[5]),
      adr: Number(m[6]),
      kast: Number(m[7]),
      rating: Number.parseFloat(m[8]),
    })
  }
  return players.length > 0 ? players : null
}

/**
 * Maps one raw system chat message to an event, or null if it is not one we care about.
 * `selfName` is the local player, needed to tell "I went back to the lobby" apart from
 * the same broadcast about somebody else.
 */
export function parseChat(content: string, selfName?: string): ChatEvent | null {
  const stats = parseStatsBlock(content)
  if (stats) return { kind: 'stats', players: stats }

  const line = content.trim()

  let m = RE_KILL.exec(line)
  if (m) {
    return {
      kind: 'kill',
      killerSide: m[1] as Side,
      killer: m[2],
      weapon: m[3].trim(),
      victimSide: m[4] as Side,
      victim: m[5],
    }
  }

  m = RE_ROUND_END.exec(line)
  if (m) return { kind: 'roundEnd', winner: teamToSide(m[1]), reason: m[2] }

  m = RE_RESULT.exec(line)
  if (m) return { kind: 'result', winner: m[1] ? teamToSide(m[1]) : 'DRAW' }

  m = RE_BOMB.exec(line)
  if (m) return { kind: 'bomb', site: m[1] }

  if (RE_QUEUE.test(line)) return { kind: 'contextReset', why: '加入匹配队列' }
  if (RE_ROOM.test(line)) return { kind: 'contextReset', why: '加入房间' }

  m = RE_LOBBY.exec(line)
  if (m) return m[1] === selfName ? { kind: 'contextReset', why: '加入大厅' } : null

  m = RE_DEATH.exec(line)
  if (m) return { kind: 'death', victim: m[1] }

  return null
}

// ---------------------------------------------------------------------------
// Match state machine
// ---------------------------------------------------------------------------

export interface TrackerOptions {
  server: string
  /** The local player. Doubles as the "did *I* just go back to the lobby?" test. */
  uploader: string
  onMatch: (match: Match & { matchId: string }) => void
}

/**
 * Feeds on raw system chat messages and emits a finished Match once the server prints the
 * end-of-match table followed by the result line.
 */
export class MatchTracker {
  private rounds: Round[] = []
  private curKills: KillEvent[] = []
  private curBomb: string | null = null
  private seq = 0
  private lastCombatTs = 0
  private pending: { players: StatLine[]; ts: number } | null = null

  constructor(private readonly opts: TrackerOptions) {}

  /** Call with every system chat message. `ts` is epoch millis. */
  accept(content: string, ts: number): void {
    this.tick(ts)
    const ev = parseChat(content, this.opts.uploader)
    if (!ev) return

    if (ev.kind === 'kill' || ev.kind === 'death' || ev.kind === 'bomb' || ev.kind === 'roundEnd') {
      if (this.lastCombatTs && ts - this.lastCombatTs > CONTEXT_GAP_MS) this.clearRounds()
      this.lastCombatTs = ts
    }

    switch (ev.kind) {
      case 'kill':
        this.curKills.push({
          seq: this.seq++,
          ts,
          killer: ev.killer,
          killerSide: ev.killerSide,
          weapon: ev.weapon,
          victim: ev.victim,
          victimSide: ev.victimSide,
          isOpening: false,
          isTrade: false,
        })
        break
      case 'death':
        this.curKills.push({
          seq: this.seq++,
          ts,
          killer: null,
          killerSide: null,
          weapon: null,
          victim: ev.victim,
          victimSide: null,
          isOpening: false,
          isTrade: false,
        })
        break
      case 'bomb':
        this.curBomb = ev.site
        break
      case 'roundEnd':
        this.rounds.push({
          idx: this.rounds.length,
          winner: ev.winner,
          reason: ev.reason,
          bombSite: this.curBomb,
          kills: this.curKills,
        })
        this.curKills = []
        this.curBomb = null
        break
      case 'stats':
        this.pending = { players: ev.players, ts }
        break
      case 'result':
        this.finalize(ev.winner, ts)
        break
      case 'contextReset':
        // Joined a lobby / queue / room: anything buffered belongs to the previous match.
        this.clearRounds()
        break
    }
  }

  /**
   * Flushes a stats table that never got its result line (rare, but a lost packet would
   * otherwise strand the match forever). Safe to call from a game tick.
   */
  tick(now: number): void {
    if (this.pending && now - this.pending.ts > RESULT_TIMEOUT_MS) {
      this.finalize('UNKNOWN', this.pending.ts)
    }
  }

  /** Drops everything buffered — used when leaving the server mid-match. */
  reset(): void {
    this.clearRounds()
    this.lastCombatTs = 0
    this.pending = null
  }

  private clearRounds(): void {
    this.rounds = []
    this.curKills = []
    this.curBomb = null
    this.seq = 0
  }

  private finalize(winner: Winner, ts: number): void {
    const pending = this.pending
    if (!pending) return
    const rounds = this.rounds
    const roster = pending.players
    this.reset()

    const sides = assignSides(rounds, roster)
    const derived = computeDerived(rounds, roster, sides)
    const score = teamScore(rounds, roster, sides)

    const observedKills = rounds.reduce(
      (n, r) => n + r.kills.filter((k) => k.killer !== null).length,
      0,
    )
    const tableKills = roster.reduce((n, p) => n + p.kills, 0)

    const match: Match = {
      version: 1,
      server: this.opts.server,
      uploader: this.opts.uploader,
      endedAt: pending.ts || ts,
      winner,
      mvp: roster.find((p) => p.isMvp)?.name ?? null,
      ctScore: score.CT,
      tScore: score.T,
      roundsObserved: rounds.length,
      // One-directional test: the table drops players who left, so the feed can legitimately
      // hold MORE kills than the table — but never fewer unless we missed rounds.
      complete: rounds.length > 0 && observedKills >= tableKills,
      players: roster.map((p) => ({
        name: p.name,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        adr: p.adr,
        kast: p.kast,
        rating: p.rating,
        isMvp: p.isMvp,
        derived: derived.get(p.name) ?? emptyDerived(),
      })),
      rounds,
    }

    this.opts.onMatch({ ...match, matchId: computeMatchId(match) })
  }
}

/**
 * Round wins per TEAM, not per side.
 *
 * Sides swap at halftime, so tallying "反恐精英 获胜" broadcasts gives a side score that can
 * contradict the announced winner (observed: 12-3 to CT while the server declared T the winner).
 * Teams are identified by where their members ended up in the stats table, and each round is
 * attributed by majority vote of the winning side's members.
 */
export function teamScore(
  rounds: Round[],
  roster: StatLine[],
  sides: Map<string, Side>[],
): Record<Side, number> {
  const finalTeam = new Map(roster.map((p) => [p.name, p.team] as const))
  const score: Record<Side, number> = { CT: 0, T: 0 }

  rounds.forEach((round, i) => {
    const votes: Record<Side, number> = { CT: 0, T: 0 }
    for (const [name, side] of sides[i]) {
      if (side !== round.winner) continue
      const team = finalTeam.get(name)
      if (team) votes[team]++
    }
    if (votes.CT > votes.T) score.CT++
    else if (votes.T > votes.CT) score.T++
  })

  return score
}

// ---------------------------------------------------------------------------
// Derived stats — inferred from the kill feed, not reported by the server
// ---------------------------------------------------------------------------

export function emptyDerived(): Derived {
  return {
    openingKills: 0,
    openingDeaths: 0,
    openingRoundWins: 0,
    tradeKills: 0,
    mk2: 0,
    mk3: 0,
    mk4: 0,
    mk5: 0,
    clutches: {},
    roundsSurvived: 0,
    roundsPlayed: 0,
    weapons: {},
    sides: {},
  }
}

/**
 * Works out which side every player was on in every round.
 *
 * Sides flip at halftime, so the final team in the stats table is only correct for the second
 * half. The kill feed tags each combatant with their side at that moment, so we take those as
 * ground truth and fill a player's quiet rounds from their nearest known round.
 */
export function assignSides(rounds: Round[], roster: StatLine[]): Map<string, Side>[] {
  const observed = rounds.map((r) => {
    const m = new Map<string, Side>()
    for (const k of r.kills) {
      if (k.killer && k.killerSide) m.set(k.killer, k.killerSide)
      if (k.victimSide) m.set(k.victim, k.victimSide)
    }
    return m
  })

  const rosterSide = new Map(roster.map((p) => [p.name, p.team] as const))
  const names = new Set<string>(rosterSide.keys())
  for (const m of observed) for (const n of m.keys()) names.add(n)

  return rounds.map((_, i) => {
    const out = new Map<string, Side>()
    for (const name of names) {
      let side = observed[i].get(name)
      for (let d = 1; side === undefined && d < rounds.length; d++) {
        side = observed[i - d]?.get(name) ?? observed[i + d]?.get(name)
      }
      side ??= rosterSide.get(name)
      if (side) out.set(name, side)
    }
    return out
  })
}

/** Rounds in which a non-roster player (someone who left before the table printed) was present. */
function presenceWindow(rounds: Round[]): Map<string, [number, number]> {
  const seen = new Map<string, [number, number]>()
  rounds.forEach((r, i) => {
    for (const k of r.kills) {
      for (const n of [k.killer, k.victim]) {
        if (!n) continue
        const cur = seen.get(n)
        if (cur) cur[1] = i
        else seen.set(n, [i, i])
      }
    }
  })
  return seen
}

/**
 * Replays every round from the kill feed to recover stats the server does not broadcast:
 * opening duels, multi-kills, clutches, trade kills, survival and weapon usage.
 *
 * Mutates `isOpening` / `isTrade` on the kill events in place so the timeline can show them.
 */
export function computeDerived(
  rounds: Round[],
  roster: StatLine[],
  sides: Map<string, Side>[] = assignSides(rounds, roster),
): Map<string, Derived> {
  const acc = new Map<string, Derived>()
  for (const p of roster) acc.set(p.name, emptyDerived())

  const rosterNames = new Set(roster.map((p) => p.name))
  const window = presenceWindow(rounds)

  const bump = (name: string, fn: (d: Derived) => void) => {
    const d = acc.get(name)
    if (d) fn(d)
  }

  rounds.forEach((round, ri) => {
    const sideOf = sides[ri]

    // Who is on the server for this round: everyone still there at the end, plus anyone who
    // left mid-match but was still active during this round.
    const participants = new Set<string>()
    for (const name of rosterNames) if (sideOf.has(name)) participants.add(name)
    for (const [name, [from, to]] of window) {
      if (!rosterNames.has(name) && ri >= from && ri <= to && sideOf.has(name)) participants.add(name)
    }

    const alive = new Map<Side, Set<string>>([
      ['CT', new Set()],
      ['T', new Set()],
    ])
    for (const name of participants) alive.get(sideOf.get(name)!)!.add(name)
    const startCount = { CT: alive.get('CT')!.size, T: alive.get('T')!.size }
    const clutchesTrustworthy =
      startCount.CT <= MAX_TEAM_SIZE && startCount.T <= MAX_TEAM_SIZE

    const killsThisRound = new Map<string, number>()
    const died = new Set<string>()
    const clutched = new Set<Side>()
    let openingDone = false

    for (const k of round.kills) {
      k.isOpening = false
      k.isTrade = false

      if (k.killer) {
        const killerSide = sideOf.get(k.killer) ?? k.killerSide

        if (!openingDone) {
          openingDone = true
          k.isOpening = true
          bump(k.killer, (d) => {
            d.openingKills++
            if (killerSide === round.winner) d.openingRoundWins++
          })
          bump(k.victim, (d) => d.openingDeaths++)
        }

        // A trade: the player we just killed had killed one of our team inside the window.
        const isTrade = round.kills.some(
          (prev) =>
            prev.seq < k.seq &&
            prev.killer === k.victim &&
            k.ts - prev.ts <= TRADE_WINDOW_MS &&
            killerSide !== undefined &&
            (sideOf.get(prev.victim) ?? prev.victimSide) === killerSide,
        )
        if (isTrade) {
          k.isTrade = true
          bump(k.killer, (d) => d.tradeKills++)
        }

        killsThisRound.set(k.killer, (killsThisRound.get(k.killer) ?? 0) + 1)
        bump(k.killer, (d) => {
          if (k.weapon) d.weapons[k.weapon] = (d.weapons[k.weapon] ?? 0) + 1
          if (killerSide) {
            const s = (d.sides[killerSide] ??= { kills: 0, deaths: 0, rounds: 0 })
            s.kills++
          }
        })
      }

      const victimSide = sideOf.get(k.victim) ?? k.victimSide
      if (victimSide && alive.get(victimSide)!.delete(k.victim)) {
        died.add(k.victim)
        bump(k.victim, (d) => {
          const s = (d.sides[victimSide] ??= { kills: 0, deaths: 0, rounds: 0 })
          s.deaths++
        })
      }

      // Someone just became the last player standing on their side.
      for (const side of ['CT', 'T'] as const) {
        if (!clutchesTrustworthy) break
        const mine = alive.get(side)!
        const theirs = alive.get(side === 'CT' ? 'T' : 'CT')!
        if (clutched.has(side) || startCount[side] <= 1 || mine.size !== 1 || theirs.size === 0) continue
        clutched.add(side)
        const hero = [...mine][0]
        const key = `1v${theirs.size}`
        bump(hero, (d) => {
          const [wins, attempts] = d.clutches[key] ?? [0, 0]
          d.clutches[key] = [wins + (round.winner === side ? 1 : 0), attempts + 1]
        })
      }
    }

    for (const name of participants) {
      bump(name, (d) => {
        d.roundsPlayed++
        if (!died.has(name)) d.roundsSurvived++
        const side = sideOf.get(name)
        if (side) {
          const s = (d.sides[side] ??= { kills: 0, deaths: 0, rounds: 0 })
          s.rounds++
        }
      })
    }

    for (const [name, n] of killsThisRound) {
      if (n < 2) continue
      bump(name, (d) => {
        if (n === 2) d.mk2++
        else if (n === 3) d.mk3++
        else if (n === 4) d.mk4++
        else d.mk5++
      })
    }
  })

  return acc
}
