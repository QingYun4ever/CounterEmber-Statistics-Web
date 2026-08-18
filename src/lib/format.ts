import type { CSSProperties } from 'react'
import type { Side } from './protocol'

export const SIDE_NAME: Record<Side, string> = { CT: '反恐精英', T: '恐怖分子' }
export const SIDE_SHORT: Record<Side, string> = { CT: 'CT', T: 'T' }

/** Rating colour scale. Anything above 1.5 gets the violet gradient treatment. */
export function ratingStyle(rating: number): CSSProperties {
  if (rating > 1.5) {
    return {
      backgroundImage: 'linear-gradient(92deg, #7c5cff, #b15cff)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    }
  }
  if (rating >= 1.15) return { color: '#4f7dff' }
  if (rating >= 0.85) return { color: '#626c85' }
  return { color: '#e5566a' }
}

/** Flat colour for bars and charts, where a gradient is not practical. */
export function ratingColor(rating: number): string {
  if (rating > 1.5) return '#8f5cff'
  if (rating >= 1.15) return '#4f7dff'
  if (rating >= 0.85) return '#626c85'
  return '#e5566a'
}

export const fmt2 = (n: number) => n.toFixed(2)
export const fmt1 = (n: number) => n.toFixed(1)
export const pct = (n: number) => `${Math.round(n)}%`

export function kd(kills: number, deaths: number): string {
  return deaths === 0 ? kills.toFixed(2) : (kills / deaths).toFixed(2)
}

export function ratio(a: number, b: number): number {
  return b === 0 ? 0 : (a / b) * 100
}

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtDay(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function relative(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.round(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天前`
  return fmtDate(ms)
}
