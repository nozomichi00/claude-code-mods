import { describe, expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import {
  addTokens, barCells, formatTokens, cacheState, formatMinutes, formatPercent, formatResetTime, formatUntil,
  isHot, levelOf, toSnapshot,
} from '../hooks/meter'

const MINUTE_MS = 60_000

const usage: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 84_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 81.5, resetsAt: '2026-10-12T10:00:00Z' },
    { kind: 'seven_day', percentUsed: 12 },
  ],
}

describe('toSnapshot', () => {
  test('picks context, five_hour and seven_day figures', async () => {
    const snap = toSnapshot(usage, 123)
    expect(snap.contextPercent).toBe(42)
    expect(snap.fiveHour).toEqual({ percent: 81.5, resetsAt: '2026-10-12T10:00:00Z' })
    expect(snap.sevenDay?.percent).toBe(12)
    expect(snap.lastResponseAt).toBe(123)
  })

  test('leaves missing windows and context as null', async () => {
    const snap = toSnapshot({ startedAt: 0, context: { window: 200_000 }, rateLimits: [] }, null)
    expect(snap.contextPercent).toBeNull()
    expect(snap.fiveHour).toBeNull()
    expect(snap.sevenDay).toBeNull()
  })
})

describe('isHot', () => {
  test('turns red only above 80 percent', async () => {
    expect(isHot(80)).toBe(false)
    expect(isHot(80.1)).toBe(true)
  })
})

describe('formatPercent', () => {
  test('rounds to a whole percent', async () => {
    expect(formatPercent(81.5)).toBe('82%')
  })
})

describe('formatResetTime', () => {
  test('shows HH:MM on the same day and M/D HH:MM on another', async () => {
    const at = new Date(2026, 9, 12, 18, 5).getTime()
    expect(formatResetTime(new Date(at).toISOString(), at - 60 * MINUTE_MS)).toBe('18:05')
    expect(formatResetTime(new Date(at).toISOString(), at - 24 * 60 * MINUTE_MS)).toBe('10/12 18:05')
  })

  test('shows ? for an unreadable timestamp', async () => {
    expect(formatResetTime('nope', 0)).toBe('?')
  })
})

describe('cacheState', () => {
  test('is unknown before the first response', async () => {
    expect(cacheState(null, 0, 60)).toBe('unknown')
  })

  test('counts down whole minutes and the share of the TTL used', async () => {
    expect(cacheState(0, 15 * MINUTE_MS, 60)).toEqual({ remainingMinutes: 45, usedPercent: 25 })
  })

  test('crosses 80 percent used with under a fifth of the TTL left', async () => {
    const state = cacheState(0, 50 * MINUTE_MS, 60)
    expect(state !== 'unknown' && state !== 'expired' && isHot(state.usedPercent)).toBe(true)
  })

  test('expires once the TTL has passed', async () => {
    expect(cacheState(0, 60 * MINUTE_MS, 60)).toBe('expired')
    expect(cacheState(0, 5 * MINUTE_MS, 5)).toBe('expired')
  })
})

describe('levelOf', () => {
  test('is ok up to 50, warn up to 80, hot above', async () => {
    expect(levelOf(50)).toBe('ok')
    expect(levelOf(50.1)).toBe('warn')
    expect(levelOf(80)).toBe('warn')
    expect(levelOf(80.1)).toBe('hot')
  })
})

describe('barCells', () => {
  test('fills whole cells and one eighth-step partial, padding to width', async () => {
    expect(barCells(0, 10)).toEqual({ fill: '', rest: ' '.repeat(10) })
    expect(barCells(100, 10)).toEqual({ fill: '█'.repeat(10), rest: '' })
    expect(barCells(25, 10)).toEqual({ fill: '██▌', rest: ' '.repeat(7) })
  })

  test('clamps out-of-range percentages', async () => {
    expect(barCells(150, 4).fill).toBe('████')
    expect(barCells(-5, 4).fill).toBe('')
  })
})

describe('time formats', () => {
  test('formatMinutes reads as <1m, 45m, 2h05m', async () => {
    expect(formatMinutes(0)).toBe('<1m')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(125)).toBe('2h05m')
  })

  test('formatUntil counts down to a timestamp', async () => {
    expect(formatUntil(new Date(80 * MINUTE_MS).toISOString(), 0)).toBe('1h20m')
  })

  test('formatUntil reads days as 3d4h for the weekly reset', async () => {
    expect(formatUntil(new Date((3 * 24 * 60 + 4 * 60 + 30) * MINUTE_MS).toISOString(), 0)).toBe('3d4h')
    expect(formatMinutes(24 * 60)).toBe('1d0h')
  })
})

describe('tokens', () => {
  test('addTokens counts cache reads and writes as input', async () => {
    const total = addTokens({ input: 100, output: 10 }, {
      model: 'm', input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4,
    })
    expect(total).toEqual({ input: 106, output: 14 })
  })

  test('formatTokens reads as 812, 4.5k, 45k, 1.2M', async () => {
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(4_500)).toBe('4.5k')
    expect(formatTokens(45_300)).toBe('45k')
    expect(formatTokens(1_212_000)).toBe('1.2M')
    expect(formatTokens(2_000_000)).toBe('2M')
  })

})
