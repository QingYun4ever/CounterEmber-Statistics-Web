import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getDb()
    const { matches } = db.prepare('SELECT COUNT(*) AS matches FROM matches').get() as {
      matches: number
    }
    const { players } = db
      .prepare('SELECT COUNT(DISTINCT player) AS players FROM match_players')
      .get() as { players: number }
    return NextResponse.json({ ok: true, matches, players })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
