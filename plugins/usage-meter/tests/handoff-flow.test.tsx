import { expect, mock, test } from 'claude-code/testing'
import type { ModelForkResult, On, SessionUsage } from 'claude-code'

const NOW = new Date(2026, 9, 12, 9, 5, 7).getTime()
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 3 }, view: {} },
}

const usageAt = (percent: number): SessionUsage => ({
  startedAt: 0,
  context: { window: 200_000, tokens: percent * 2_000, percent },
  rateLimits: [],
})

/** 引擎這一層：用量會依 `percent()` 回報，其餘照常回應。 */
function engine(on: On, percent: () => number, fork: ModelForkResult) {
  const record = { writes: [] as { path: string; text: string }[], commands: [] as string[], prompts: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usageAt(percent()) }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>next:</Text>
  })
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo' }))
  on('model.fork', () => ({ value: fork }))
  on('fs.write', ($, e) => {
    record.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('command.run', ($, e) => {
    record.commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    record.prompts.push(e.text)
    return { text: e.text }
  })
  return record
}

const turn = { turnId: 't1', isAborted: false, reason: 'answer' as const, answer: 'ok', durationMs: 1, usage: { model: 'm', ...ZERO_USAGE } }

test('the handoff button always sits right of Context and hands off: save, clear, send', async ($, on) => {
  mock.clock(on, { now: NOW })
  let percent = 65
  const record = engine(on, () => percent, { isAnswered: true, text: '```markdown\n## 目前目標\n做交接 mod\n```', usage: ZERO_USAGE })
  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)

  // 不看 Context 百分比，低用量時也在
  let ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band })
  expect((await ui.find({ key: 'handoff' }))?.props.label).toBe('[交接]')
  await ui.unmount()

  percent = 72
  await $.turn.complete(turn)
  ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: 'next:' })).toBeDefined()
  expect((await ui.find({ key: 'handoff' }))?.props.label).toBe('[交接]')
  await ui.press({ key: 'handoff' })
  await ui.unmount()

  expect(record.writes.length).toBe(1)
  expect(record.writes[0]?.path.replaceAll('\\', '/')).toBe('C:/Users/me/.claude/handoffs/demo-20261012-090507.md')
  expect(record.writes[0]?.text).toContain('## 目前目標\n做交接 mod')
  expect(record.commands).toEqual(['clear'])
  expect(record.prompts.length).toBe(1)
  expect(record.prompts[0]).toContain('C:/Users/me/.claude/handoffs/demo-20261012-090507.md')
  expect(record.prompts[0]?.endsWith('## 目前目標\n做交接 mod')).toBe(true)

  // 清空後按鈕仍在，Context 等下一輪重新量
  ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band })
  expect((await ui.find({ key: 'handoff' }))?.props.label).toBe('[交接]')
  expect(await ui.find({ type: 'Text', text: '72%' })).toBeUndefined()
  await ui.unmount()
})

test('a failed summary leaves the conversation alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  const record = engine(on, () => 90, { isAnswered: false, reason: 'empty-reply', usage: ZERO_USAGE })
  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)

  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band })
  await ui.press({ key: 'handoff' })
  expect(record.commands).toEqual([])
  expect(record.writes).toEqual([])
  expect((await ui.find({ key: 'handoff' }))?.props.label).toBe('[交接]')
  await ui.unmount()
})
