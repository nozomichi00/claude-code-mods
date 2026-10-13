import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage, TurnUsage } from 'claude-code'

const NOW = new Date(2026, 9, 12, 16, 0).getTime()

const usage: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000, tokens: 170_000, percent: 85 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(NOW + 80 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  ],
}

const turnUsage: TurnUsage = {
  model: 'claude-opus-5-5',
  input_tokens: 2_000,
  cache_creation_input_tokens: 10_000,
  cache_read_input_tokens: 1_200_000,
  output_tokens: 45_300,
}

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 3 }, view: {} },
})

test('draws the framed meter above the prompt at every width', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usage }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    turnId: 't1', isAborted: false, reason: 'answer', answer: 'ok', durationMs: 1, usage: turnUsage,
  })
  await clock.advance(0)

  for (const columns of [150, 120, 90]) {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band(columns) })
    expect((await ui.find({ type: 'Text', text: 'opus-5-5' }))?.props.color).toBe('#C6A0F6')
    expect((await ui.find({ type: 'Text', text: '85%' }))?.props.color).toBe('#ED8796')
    expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1.2M' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '45k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1h00m' })).toBeDefined()
    expect((await ui.find({ type: 'Box' }))?.props.borderStyle).toBe('round')
    await ui.unmount()
  }
})
