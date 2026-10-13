import type { SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'

import type { UsageMeterSnapshot, UsageMeterTokens, UsageMeterWindow } from '../types'

export const WARN_PERCENT = 50
export const HOT_PERCENT = 80
const MINUTE_MS = 60_000
const MINUTES_PER_DAY = 24 * 60
const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

export type Level = 'ok' | 'warn' | 'hot'

function toWindow(limits: SessionRateLimit[], kind: string): UsageMeterWindow | null {
  const limit = limits.find(l => l.kind === kind)
  if (limit === undefined) return null
  return { percent: limit.percentUsed, resetsAt: limit.resetsAt }
}

export function toSnapshot(usage: SessionUsage, lastResponseAt: number | null): UsageMeterSnapshot {
  return {
    contextPercent: usage.context.percent ?? null,
    fiveHour: toWindow(usage.rateLimits, 'five_hour'),
    sevenDay: toWindow(usage.rateLimits, 'seven_day'),
    lastResponseAt,
  }
}

/** 累加一輪的用量：input 含未快取、快取寫入與快取讀取。 */
export function addTokens(total: UsageMeterTokens, usage: TurnUsage): UsageMeterTokens {
  return {
    input: total.input + usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    output: total.output + usage.output_tokens,
  }
}

/** 812、45.3k、1.2M。 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${trimZero((count / 1000).toFixed(count < 10_000 ? 1 : 0))}k`
  return `${trimZero((count / 1_000_000).toFixed(1))}M`
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

export function isHot(percent: number): boolean {
  return percent > HOT_PERCENT
}

export function levelOf(percent: number): Level {
  if (percent > HOT_PERCENT) return 'hot'
  if (percent > WARN_PERCENT) return 'warn'
  return 'ok'
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

/** 以 1/8 格精度畫出的進度條：整格 █ 加一個部分格，其餘以空白補滿到 width。 */
export function barCells(percent: number, width: number): { fill: string; rest: string } {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0))
  const eighths = Math.round((clamped / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const partial = PARTIAL_BLOCKS[eighths % 8] ?? ''
  const fill = '█'.repeat(full) + partial
  const used = full + (partial === '' ? 0 : 1)
  return { fill, rest: ' '.repeat(Math.max(0, width - used)) }
}

function hhmm(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** 本地時間 HH:MM；跨日加上 M/D。 */
export function formatResetTime(iso: string, now: number): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '?'
  const today = new Date(now)
  const isSameDay = at.getFullYear() === today.getFullYear()
    && at.getMonth() === today.getMonth()
    && at.getDate() === today.getDate()
  return isSameDay ? hhmm(at) : `${at.getMonth() + 1}/${at.getDate()} ${hhmm(at)}`
}

/** 距離 iso 還有多久：3d4h、2h05m、45m、<1m。 */
export function formatUntil(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms)) return '?'
  return formatMinutes(Math.ceil(ms / MINUTE_MS))
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes >= MINUTES_PER_DAY) return `${Math.floor(minutes / MINUTES_PER_DAY)}d${Math.floor((minutes % MINUTES_PER_DAY) / 60)}h`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export type CacheState = { remainingMinutes: number; usedPercent: number } | 'expired' | 'unknown'

export function cacheState(lastResponseAt: number | null, now: number, ttlMinutes: number): CacheState {
  if (lastResponseAt === null) return 'unknown'
  const ttlMs = ttlMinutes * MINUTE_MS
  const elapsed = Math.max(0, now - lastResponseAt)
  if (elapsed >= ttlMs) return 'expired'
  return {
    remainingMinutes: Math.ceil((ttlMs - elapsed) / MINUTE_MS),
    usedPercent: (elapsed / ttlMs) * 100,
  }
}
