import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage, TurnStepResult, TurnUsage } from 'claude-code'

const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MINUTE_MS = 60_000

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 3 }, view: {} },
}

const usageAt = (context: number, fiveHour: number): SessionUsage => ({
  startedAt: 0,
  context: { window: 200_000, tokens: context * 2_000, percent: context },
  rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour, resetsAt: new Date(NOW + 90 * MINUTE_MS).toISOString() }],
})

const stepUsage: TurnUsage = {
  model: 'm', input_tokens: 1_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 500,
}

/** 引擎這一層：每步回應都附 stepUsage，用量依 current() 回報。 */
function engine(on: On, current: () => SessionUsage) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: current() }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>next:</Text>
  })
  on('turn.step', async function* ($, e): AsyncGenerator<never, TurnStepResult> {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: stepUsage }
  })
}

async function runStep($: Parameters<Parameters<typeof test>[1]>[0], index: number, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) { /* 把串流讀完 */ }
  return stream.result
}

async function textOf($: Parameters<Parameters<typeof test>[1]>[0], text: string) {
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found
}

test('updates context, quota and tokens after each step, before the turn completes', async ($, on) => {
  mock.clock(on, { now: NOW })
  let current = usageAt(10, 20)
  engine(on, () => current)
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })

  current = usageAt(30, 25)
  await runStep($, 0)
  expect(await textOf($, '30%')).toBeDefined()
  expect(await textOf($, '25%')).toBeDefined()
  expect(await textOf($, '1k')).toBeDefined()

  current = usageAt(45, 26)
  await runStep($, 1)
  expect(await textOf($, '45%')).toBeDefined()
  expect(await textOf($, '2k')).toBeDefined()
})

test('subagent steps add tokens but leave the main context alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  let current = usageAt(10, 20)
  engine(on, () => current)
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  await runStep($, 0)

  current = usageAt(70, 20)
  await runStep($, 0, 'agent-1')
  expect(await textOf($, '10%')).toBeDefined()
  expect(await textOf($, '2k')).toBeDefined()
})

test('a pushed measurement moves the quota without a response', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, () => usageAt(10, 20))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })

  const pushed = usageAt(10, 41)
  await $.session.measure({ context: pushed.context, rateLimits: pushed.rateLimits, changed: ['rateLimits'] })
  expect(await textOf($, '41%')).toBeDefined()
})

test('the cache countdown ticks every second, not every 15', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, () => usageAt(10, 20))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  await runStep($, 0)
  expect(await textOf($, '1h00m')).toBeDefined()

  // 跨過一分鐘的邊界後一秒內就要跳
  await clock.advance(MINUTE_MS + 1_000)
  expect(await textOf($, '59m')).toBeDefined()
})
