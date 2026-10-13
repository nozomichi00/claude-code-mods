import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addFile, buildPrompt, cleanSummary, fileContent, firstMessage, handoffPath, shouldOffer } from './handoff'

const DEFAULT_THRESHOLD = 70
const WARN = '#EED49F'
const BORDER = '#5B6078'

const contextPercent = atom({ plugin: 'handoff', key: 'contextPercent' } as const, null)
const phase = atom({ plugin: 'handoff', key: 'phase' } as const, 'idle')
const files = atom({ plugin: 'handoff', key: 'files' } as const, [])

async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? (await $.session.cwd())
}

async function resetConversationState($: EngineInterface): Promise<void> {
  await update($, files, () => [])
  await update($, contextPercent, () => null)
}

// 交接：寫摘要 → 存檔 → /clear → 把摘要當新對話第一句送出。
// 任何一步失敗都停在清空之前，原對話不會遺失。
async function runHandoff($: EngineInterface): Promise<void> {
  if ((await read($, phase)) === 'working') return
  await update($, phase, () => 'working')
  try {
    const reply = await $.model.fork({ prompt: buildPrompt(await read($, files)) })
    if (!reply.isAnswered) {
      $.ui.toast(`交接摘要沒寫成（${reply.reason}），對話保持原樣`)
      return
    }
    const summary = cleanSummary(reply.text)
    if (summary === '') {
      $.ui.toast('交接摘要是空的，對話保持原樣')
      return
    }
    const [home, cwd, now] = await Promise.all([homeDir($), $.session.cwd(), $.clock.now()])
    const path = handoffPath(home, cwd, now)
    await $.fs.write(path, fileContent(summary, cwd, now))

    await $.command.run({ command: 'clear' })
    await resetConversationState($)
    await $.prompt.submit({ text: firstMessage(summary, path) })
  } catch (error) {
    $.ui.toast(`交接失敗：${String(error)}`)
  } finally {
    await update($, phase, () => 'idle')
  }
}

async function trackFile($: EngineInterface, path: string, agentId: string | undefined): Promise<void> {
  if (agentId === undefined) await update($, files, list => addFile(list, path))
}

export const register: Register = (on, options) => {
  const configured = Number(options.thresholdPercent)
  const threshold = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_THRESHOLD

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'handoff', description: '寫交接摘要並存檔，清空對話後把摘要送進新對話' })
    return result
  })

  on('command.run', { command: 'handoff' }, ($) => {
    void runHandoff($)
    return { text: '正在寫交接摘要，完成後會清空對話並送出摘要。' }
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (percent !== undefined) await update($, contextPercent, () => percent)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await resetConversationState($)
    return next(e)
  })

  // 記下主對話改過的檔案，摘要的「改過的檔案」以此為準
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const [percent, current] = await Promise.all([read($, contextPercent), read($, phase)])
    if (current === 'idle' && (e.props.isWorking || !shouldOffer(percent, threshold))) return below
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="handoff" borderStyle="round" borderColor={BORDER} paddingX={1} gap={1} width={e.props.bodyColumns}>
          {current === 'working'
            ? <Text color={WARN}>正在寫交接摘要…完成後會清空對話並送出摘要</Text>
            : (
              <>
                <Text color={WARN} bold>Context {percent}%</Text>
                <Text dimColor>建議交接到新對話</Text>
                <Button key="go" hotkey="h" variant="primary" label="交接" onPress={() => void runHandoff($)} />
              </>
            )}
        </Box>
      </Box>
    )
  })
}
