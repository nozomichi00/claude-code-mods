import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addTokens, barCells, cacheState, formatMinutes, formatPercent,
  formatResetTime, formatTokens, formatUntil, levelOf,
  toSnapshot,
} from './meter'
import type { Level } from './meter'
import { addFile, buildPrompt, cleanSummary, fileContent, firstMessage, handoffPath } from './handoff'

// 每秒推進時鐘，倒數（重置時間、快取）隨時鐘即時跳動
const TICK_MS = 1_000
const DEFAULT_TTL_MINUTES = 60
// 圓角框：左右框線各 1 欄、左右內距各 1 欄
const FRAME_COLUMNS = 4

// Catppuccin Macchiato 色系：深色主題下柔和、三段對比清楚
const COLOR: Record<Level, string> = { ok: '#8BD5CA', warn: '#EED49F', hot: '#ED8796' }
const TRACK = '#363A4F'
const BORDER = '#5B6078'
const ACCENT = '#8AADF4'

// 依可用寬度切換版面：寬版長條＋相對時間、中版短條、窄版純文字
const WIDE_COLUMNS = 140
const MEDIUM_COLUMNS = 110
const WIDE_BAR = 8
const MEDIUM_BAR = 5
const CACHE_BAR = 6


const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, { input: 0, output: 0 })
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)
const handoffPhase = atom({ plugin: 'usage-meter', key: 'handoffPhase' } as const, 'idle')
const editedFiles = atom({ plugin: 'usage-meter', key: 'editedFiles' } as const, [])

type Layout = { bar: number; isWide: boolean }

function layoutFor(columns: number): Layout {
  if (columns >= WIDE_COLUMNS) return { bar: WIDE_BAR, isWide: true }
  if (columns >= MEDIUM_COLUMNS) return { bar: MEDIUM_BAR, isWide: false }
  return { bar: 0, isWide: false }
}

async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? (await $.session.cwd())
}

/** 對話清空後：檔案紀錄歸零，Context 與快取等下一輪重新量。 */
async function resetConversation($: EngineInterface): Promise<void> {
  await update($, editedFiles, () => [])
  await update($, snapshot, prev => (prev === null ? null : { ...prev, contextPercent: null, lastResponseAt: null }))
}

/** 重讀用量；hasResponded 表示剛收到一次回應，快取倒數從此刻重算。 */
async function refreshSnapshot($: EngineInterface, hasResponded: boolean): Promise<void> {
  const [usage, t] = await Promise.all([$.session.usage(), $.clock.now()])
  await update($, snapshot, prev => toSnapshot(usage, hasResponded ? t : (prev?.lastResponseAt ?? null)))
  await update($, now, () => t)
}

async function trackFile($: EngineInterface, path: string, agentId: string | undefined): Promise<void> {
  if (agentId === undefined) await update($, editedFiles, list => addFile(list, path))
}

// 交接：寫摘要 → 存檔 → /clear → 把摘要當新對話第一句送出。
// 任何一步失敗都停在清空之前，原對話不會遺失。
async function runHandoff($: EngineInterface): Promise<void> {
  if ((await read($, handoffPhase)) === 'working') return
  await update($, handoffPhase, () => 'working')
  try {
    const reply = await $.model.fork({ prompt: buildPrompt(await read($, editedFiles)) })
    if (!reply.isAnswered) {
      $.ui.toast(`交接摘要沒寫成（${reply.reason}），對話保持原樣`)
      return
    }
    const summary = cleanSummary(reply.text)
    if (summary === '') {
      $.ui.toast('交接摘要是空的，對話保持原樣')
      return
    }
    const [home, cwd, t] = await Promise.all([homeDir($), $.session.cwd(), $.clock.now()])
    const path = handoffPath(home, cwd, t)
    await $.fs.write(path, fileContent(summary, cwd, t))

    await $.command.run({ command: 'clear' })
    await resetConversation($)
    await $.prompt.submit({ text: firstMessage(summary, path) })
  } catch (error) {
    $.ui.toast(`交接失敗：${String(error)}`)
  } finally {
    await update($, handoffPhase, () => 'idle')
  }
}

export const register: Register = (on, options) => {
  const ttlMinutes = Number(options.cacheTtlMinutes) || DEFAULT_TTL_MINUTES

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const [usage, previous] = await Promise.all([$.session.usage(), read($, snapshot)])
    await update($, snapshot, () => toSnapshot(usage, previous?.lastResponseAt ?? null))
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)
    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })
    await $.command.register({ name: 'handoff', description: '寫交接摘要並存檔，清空對話後把摘要送進新對話' })
    return result
  })

  on('command.run', { command: 'handoff' }, ($) => {
    void runHandoff($)
    return { text: '正在寫交接摘要，完成後會清空對話並送出摘要。' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await resetConversation($)
    return next(e)
  })

  // 記下主對話改過的檔案，交接摘要的「改過的檔案」以此為準
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await trackFile($, e.file_path, e.agentId)
    return result
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await trackFile($, e.file_path, e.agentId)
    return result
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await trackFile($, e.notebook_path, e.agentId)
    return result
  })

  // 每次模型回應（回合中的每一步）就更新：Context、額度、Token、快取倒數不必等整個回合結束
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const stepUsage = result.usage
    if (stepUsage !== null) await update($, tokens, total => addTokens(total, stepUsage))
    if (e.agentId === undefined) await refreshSnapshot($, stepUsage !== null)
    return result
  })

  // 額度跨過整數百分點時引擎會主動推送，不必等下一次回應
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await update($, snapshot, prev => toSnapshot({ startedAt: 0, context: e.context, rateLimits: e.rateLimits }, prev?.lastResponseAt ?? null))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refreshSnapshot($, false)
    return result
  })

  // 同一個 band 可能還有其他 mod：先取下層畫的內容，再接上用量列
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const snap = await read($, snapshot)
    if (snap === null) return below
    const [t, used, phase] = await Promise.all([read($, now), read($, tokens), read($, handoffPhase)])
    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = e.props.bodyColumns - FRAME_COLUMNS
    const layout = layoutFor(columns)

    const bar = (key: string, percent: number | null, width: number, level: Level) => {
      if (width === 0) return null
      const { fill, rest } = barCells(percent ?? 0, width)
      return (
        <Text key={key} color={COLOR[level]} backgroundColor={TRACK}>{fill}{rest}</Text>
      )
    }

    // 交接按鈕常駐在 Context 右邊，隨時可按；交接進行中改成提示文字
    const handoff = phase === 'working'
      ? <Text key="handoff-busy" color={COLOR.warn}>交接中…</Text>
      : <Button key="handoff" plain label="[交接]" onPress={() => void runHandoff($)} />

    const gauge = (key: string, label: string, percent: number | null, extra: string) => {
      const level = percent === null ? 'ok' : levelOf(percent)
      return (
        <Box key={key} flexDirection="row" gap={1}>
          <Text dimColor>{label}</Text>
          {bar(`${key}-bar`, percent, layout.bar, level)}
          {percent === null
            ? <Text dimColor>—</Text>
            : <Text bold color={COLOR[level]}>{formatPercent(percent)}</Text>}
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
    const weekReset = week?.resetsAt === undefined ? '' : `↻ ${formatUntil(week.resetsAt, t)}`

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
              {gauge('context', 'Context', snap.contextPercent, '')}
              {handoff}
              {divider('d1')}
              {gauge('five-hour', '5H', five?.percent ?? null, fiveReset)}
              {divider('d2')}
              {gauge('seven-day', '7D', week?.percent ?? null, weekReset)}
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
