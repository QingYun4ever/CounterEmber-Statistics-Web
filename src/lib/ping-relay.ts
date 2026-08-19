import { createHash, randomBytes } from 'node:crypto'

export const PING_NORMAL_TTL_MS = 4_000
export const PING_WARNING_TTL_MS = 5_000
export const PING_COOLDOWN_MS = 800
export const PING_MAX_PER_PLAYER = 3
export const PING_MAX_PER_CHANNEL = 15
export const PING_LONG_POLL_MS = 10_000
export const PING_MEMBER_TTL_MS = 2 * 60_000

export type PingKind = 'normal' | 'warning'

export interface PingMarker {
  id: string
  owner: string
  kind: PingKind
  x: number
  y: number
  z: number
  dimension: string
  createdAt: number
  expiresAt: number
}

export interface PingState {
  channel: string
  revision: number
  /**
   * Relay clock when the snapshot was taken. createdAt/expiresAt are relay timestamps, so a client
   * whose own clock differs must rebase them onto this value instead of comparing them directly.
   */
  now: number
  markers: PingMarker[]
}

type Waiter = {
  since: number
  resolve: (state: PingState) => void
  timer: ReturnType<typeof setTimeout>
}

type PingMember = {
  player: string
  lastSeen: number
}

type PingChannel = {
  channel: string
  revision: number
  lastSeen: number
  markers: Map<string, PingMarker>
  lastNormalByPlayer: Map<string, number>
  members: Map<string, PingMember>
  waiters: Set<Waiter>
}

export type PingPublishResult =
  | { state: PingState }
  | {
      error: 'unauthorized' | 'cooldown' | 'limit' | 'channel-limit' | 'unknown-marker'
      retryAfterMs?: number
    }

/**
 * Ephemeral, single-process relay state. Pings intentionally do not go into SQLite: they live for
 * only a few seconds, and the existing deployment is one small Next.js container. A restart just
 * clears stale combat hints; clients join again automatically.
 *
 * A successful join also receives a short-lived member token. The token is required for polling and
 * publishing, so knowing a channel id is not enough to inject or read its state accidentally.
 */
class PingRelay {
  private readonly channels = new Map<string, PingChannel>()

  join(channel: string, player: string, now: number): { token: string; state: PingState } {
    const state = this.channel(channel, now)
    for (const [token, member] of state.members) {
      if (member.player === player) state.members.delete(token)
    }
    const token = randomBytes(24).toString('base64url')
    state.members.set(token, { player, lastSeen: now })
    state.lastSeen = now
    this.prune(now)
    return { token, state: this.snapshot(state, now) }
  }

  publish(
    channel: string,
    token: string,
    input: Omit<PingMarker, 'createdAt' | 'expiresAt'>,
    now: number,
  ): PingPublishResult {
    const state = this.channels.get(channel)
    const member = this.member(state, token, now)
    if (!state || !member || member.player !== input.owner) return { error: 'unauthorized' }

    state.lastSeen = now
    this.removeExpired(state, now)

    const existing = state.markers.get(input.id)
    if (input.kind === 'warning') {
      // A warning is the second click on the same local marker. It may bypass the normal cooldown,
      // but it may never upgrade somebody else's marker.
      if (!existing || existing.owner !== input.owner) {
        return { error: 'unknown-marker' }
      }
      state.markers.set(input.id, {
        ...existing,
        kind: 'warning',
        x: input.x,
        y: input.y,
        z: input.z,
        dimension: input.dimension,
        createdAt: now,
        expiresAt: now + PING_WARNING_TTL_MS,
      })
      state.revision++
      this.notify(state, now)
      return { state: this.snapshot(state, now) }
    }

    // Retries of an already accepted normal marker are idempotent and do not spend another slot.
    if (existing) {
      if (existing.owner !== input.owner) return { error: 'unknown-marker' }
      return { state: this.snapshot(state, now) }
    }

    const lastNormal = state.lastNormalByPlayer.get(input.owner)
    if (lastNormal !== undefined && now - lastNormal < PING_COOLDOWN_MS) {
      return { error: 'cooldown', retryAfterMs: PING_COOLDOWN_MS - (now - lastNormal) }
    }

    const playerCount = [...state.markers.values()].filter((marker) => marker.owner === input.owner).length
    if (playerCount >= PING_MAX_PER_PLAYER) return { error: 'limit' }
    if (state.markers.size >= PING_MAX_PER_CHANNEL) return { error: 'channel-limit' }

    state.lastNormalByPlayer.set(input.owner, now)
    state.markers.set(input.id, {
      ...input,
      createdAt: now,
      expiresAt: now + PING_NORMAL_TTL_MS,
    })
    state.revision++
    this.notify(state, now)
    return { state: this.snapshot(state, now) }
  }

  wait(
    channel: string,
    token: string,
    since: number,
    now: number,
    timeoutMs: number,
  ): Promise<PingState | null> {
    const state = this.channels.get(channel)
    const member = this.member(state, token, now)
    if (!state || !member) return Promise.resolve(null)

    state.lastSeen = now
    this.removeExpired(state, now)
    if (state.revision > since) return Promise.resolve(this.snapshot(state, now))

    return new Promise((resolve) => {
      const waiter: Waiter = {
        since,
        resolve,
        timer: setTimeout(() => {
          state.waiters.delete(waiter)
          resolve(this.snapshot(state, Date.now()))
        }, timeoutMs),
      }
      state.waiters.add(waiter)
    })
  }

  private channel(channel: string, now: number): PingChannel {
    let state = this.channels.get(channel)
    if (!state) {
      state = {
        channel,
        revision: 0,
        lastSeen: now,
        markers: new Map(),
        lastNormalByPlayer: new Map(),
        members: new Map(),
        waiters: new Set(),
      }
      this.channels.set(channel, state)
    }
    return state
  }

  private member(state: PingChannel | undefined, token: string, now: number): PingMember | null {
    if (!state || !token) return null
    const member = state.members.get(token)
    if (!member || now - member.lastSeen > PING_MEMBER_TTL_MS) {
      if (member) state.members.delete(token)
      return null
    }
    member.lastSeen = now
    return member
  }

  private snapshot(state: PingChannel, now: number): PingState {
    this.removeExpired(state, now)
    return {
      channel: state.channel,
      revision: state.revision,
      now,
      markers: [...state.markers.values()].sort((a, b) => a.createdAt - b.createdAt),
    }
  }

  private removeExpired(state: PingChannel, now: number): void {
    for (const [id, marker] of state.markers) {
      if (now >= marker.expiresAt) state.markers.delete(id)
    }
  }

  private notify(state: PingChannel, now: number): void {
    const current = this.snapshot(state, now)
    for (const waiter of [...state.waiters]) {
      if (state.revision <= waiter.since) continue
      clearTimeout(waiter.timer)
      state.waiters.delete(waiter)
      waiter.resolve(current)
    }
  }

  private prune(now: number): void {
    for (const [key, state] of this.channels) {
      this.removeExpired(state, now)
      for (const [token, member] of state.members) {
        if (now - member.lastSeen > PING_MEMBER_TTL_MS) state.members.delete(token)
      }
      if (
        state.waiters.size === 0 &&
        state.markers.size === 0 &&
        state.members.size === 0 &&
        now - state.lastSeen > 5 * 60_000
      ) {
        this.channels.delete(key)
      }
    }
  }
}

const globalForRelay = globalThis as unknown as { __cestatsPingRelay?: PingRelay }

export function getPingRelay(): PingRelay {
  if (!globalForRelay.__cestatsPingRelay) {
    globalForRelay.__cestatsPingRelay = new PingRelay()
  }
  return globalForRelay.__cestatsPingRelay
}

/** Stable opaque owner id shared by the mod and relay; raw player names never enter ping state. */
export function derivePingOwner(player: string): string {
  return createHash('sha256')
    .update(`owner|${player.trim().toLowerCase()}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
}

/** Opaque, deterministic channel id. It contains no player names or raw room code. */
export function derivePingChannel(mode: 'auto' | 'code', matchKey: string, teamKey: string): string {
  return createHash('sha256')
    .update(`cestats-ping-v1|${mode}|${matchKey}|${teamKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
}
