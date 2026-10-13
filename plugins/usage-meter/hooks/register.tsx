import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  FIVE_HOUR_MS, SEVEN_DAY_MS, addTokens, barCells, cacheState, formatMinutes, formatPercent,
  formatResetTime, formatTokens, formatUntil, formatWeeklyReset, isOverPace, levelOf, shortModel,
  toSnapshot,
} from './meter'
import type { Level } from './meter'

const TICK_MS = 15_000
const DEFAULT_TTL_MINUTES = 60
// 圓角框：左右框線各 1 欄、左右內距各 1 欄
const FRAME_COLUMNS = 4

// Catppuccin Macchiato 色系：深色主題下柔和、三段對比清楚
const COLOR: Record<Level, string> = { ok: '#8BD5CA', warn: '#EED49F', hot: '#ED8796' }
const TRACK = '#363A4F'
const BORDER = '#5B6078'
const ACCENT = '#8AADF4'
const MODEL = '#C6A0F6'

// 依可用寬度切換版面：寬版長條＋相對時間、中版短條、窄版純文字
const WIDE_COLUMNS = 140
const MEDIUM_COLUMNS = 110
const WIDE_BAR = 8
const MEDIUM_BAR = 5
const CACHE_BAR = 6

const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, { input: 0, output: 0 })
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

type Layout = { bar: number; isWide: boolean }

function layoutFor(columns: number): Layout {
  if (columns >= WIDE_COLUMNS) return { bar: WIDE_BAR, isWide: true }
  if (columns >= MEDIUM_COLUMNS) return { bar: MEDIUM_BAR, isWide: false }
  return { bar: 0, isWide: false }
}

export const register: Register = (on, options) => {
  const ttlMinutes = Number(options.cacheTtlMinutes) || DEFAULT_TTL_MINUTES

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const [usage, model, previous] = await Promise.all([$.session.usage(), $.session.model(), read($, snapshot)])
    await update($, snapshot, () => toSnapshot(usage, model, previous?.lastResponseAt ?? null))
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)
    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const turnUsage = e.usage
    if (turnUsage !== undefined) await update($, tokens, total => addTokens(total, turnUsage))
    if (e.agentId !== undefined) return result

    const [usage, model, t] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
    await update($, snapshot, prev => toSnapshot(usage, model, turnUsage ? t : (prev?.lastResponseAt ?? null)))
    await update($, now, () => t)
    return result
  })

  // 同一個 band 可能還有其他 mod（例如 next-steps）：先取下層畫的內容，再接上用量列
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const snap = await read($, snapshot)
    if (snap === null) return below
    const [t, used] = await Promise.all([read($, now), read($, tokens)])
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns - FRAME_COLUMNS
    const layout = layoutFor(columns)

    const bar = (key: string, percent: number | null, width: number, level: Level) => {
      if (width === 0) return null
      const { fill, rest } = barCells(percent ?? 0, width)
      return (
        <Text key={key} color={COLOR[level]} backgroundColor={TRACK}>{fill}{rest}</Text>
      )
    }

    const gauge = (key: string, label: string, percent: number | null, extra: string, isPaceAlert = false) => {
      const level = percent === null ? 'ok' : levelOf(percent)
      return (
        <Box key={key} flexDirection="row" gap={1}>
          <Text dimColor>{label}</Text>
          {bar(`${key}-bar`, percent, layout.bar, level)}
          {percent === null
            ? <Text dimColor>—</Text>
            : <Text bold color={COLOR[level]}>{formatPercent(percent)}</Text>}
          {isPaceAlert ? <Text color={COLOR.hot}>▲</Text> : null}
          {extra === '' ? null : <Text dimColor>{extra}</Text>}
        </Box>
      )
    }

    const divider = (key: string) => <Text key={key} color={TRACK}>│</Text>

    const five = snap.fiveHour
    const fiveReset = five?.resetsAt === undefined ? ''
      : layout.isWide ? `↻ ${formatResetTime(five.resetsAt, t)} · ${formatUntil(five.resetsAt, t)}`
      : `↻ ${formatResetTime(five.resetsAt, t)}`
    const week = snap.sevenDay
    const weekReset = week?.resetsAt !== undefined && layout.isWide ? `↻ ${formatWeeklyReset(week.resetsAt)}` : ''

    const cache = cacheState(snap.lastResponseAt, t, ttlMinutes)
    const cacheLevel: Level = cache === 'expired' ? 'hot' : cache === 'unknown' ? 'ok' : levelOf(cache.usedPercent)
    const cacheRemaining = cache === 'expired' || cache === 'unknown' ? 0 : 100 - cache.usedPercent
    const cacheText = cache === 'unknown' ? '—'
      : cache === 'expired' ? 'expired'
      : formatMinutes(cache.remainingMinutes)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="frame" borderStyle="round" borderColor={BORDER} paddingX={1} width={e.props.bodyColumns}>
          <Box flexDirection="row" justifyContent="space-between" width={columns}>
            <Box flexDirection="row" gap={1}>
              {snap.model === null ? null : <Text key="model" bold color={MODEL}>{shortModel(snap.model)}</Text>}
              {snap.model === null ? null : divider('d0')}
              {gauge('context', 'Context', snap.contextPercent, '')}
              {divider('d1')}
              {gauge('five-hour', '5H', five?.percent ?? null, fiveReset,
                five !== null && isOverPace(five, FIVE_HOUR_MS, t))}
              {divider('d2')}
              {gauge('seven-day', '7D', week?.percent ?? null, weekReset,
                week !== null && isOverPace(week, SEVEN_DAY_MS, t))}
              {divider('d3')}
              <Box key="tokens" flexDirection="row" gap={1}>
                <Text dimColor>Token</Text>
                <Text dimColor>↑</Text>
                <Text bold color={ACCENT}>{formatTokens(used.input)}</Text>
                <Text dimColor>↓</Text>
                <Text bold color={ACCENT}>{formatTokens(used.output)}</Text>
              </Box>
            </Box>
            <Box key="cache" flexDirection="row" gap={1}>
              <Text color={ACCENT}>Cache</Text>
              {bar('cache-bar', cacheRemaining, layout.bar === 0 ? 0 : CACHE_BAR, cacheLevel)}
              {cache === 'unknown'
                ? <Text dimColor>{cacheText}</Text>
                : <Text bold color={COLOR[cacheLevel]}>{cacheText}</Text>}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
