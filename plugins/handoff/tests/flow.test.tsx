import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 12, 9, 5, 7).getTime()

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} },
}

const measure = (percent: number) => ({
  context: { window: 200_000, tokens: percent * 2_000, percent },
  rateLimits: [],
  changed: ['context' as const],
})

test('the button appears at 70% and hands off: save, clear, then send the summary', async ($, on) => {
  mock.clock(on, { now: NOW })
  const writes: { path: string; text: string }[] = []
  const commands: string[] = []
  const prompts: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage</Text>
  })
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo' }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '```markdown\n## 目前目標\n做交接 mod\n```',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('command.run', ($, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })

  await $.session.measure(measure(65))
  let ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...band })
  expect(await ui.find({ key: 'go' })).toBeUndefined()
  await ui.unmount()

  await $.session.measure(measure(72))
  ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: 'usage' })).toBeDefined()
  expect((await ui.find({ key: 'go' }))?.props.label).toBe('交接')
  await ui.press({ key: 'go' })
  await ui.unmount()

  expect(writes.length).toBe(1)
  expect(writes[0]?.path.replaceAll('\\', '/')).toBe('C:/Users/me/.claude/handoffs/demo-20261012-090507.md')
  expect(writes[0]?.text).toContain('## 目前目標\n做交接 mod')
  expect(commands).toEqual(['clear'])
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('C:/Users/me/.claude/handoffs/demo-20261012-090507.md')
  expect(prompts[0]?.endsWith('## 目前目標\n做交接 mod')).toBe(true)

  // 清空後按鈕消失，等下一次量測
  ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...band })
  expect(await ui.find({ key: 'go' })).toBeUndefined()
  await ui.unmount()
})

test('a failed summary leaves the conversation alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage</Text>
  })
  on('model.fork', () => ({
    value: {
      isAnswered: false, reason: 'empty-reply',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', ($, e) => {
    commands.push(e.command)
    return { text: '' }
  })

  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure(90))
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...band })
  await ui.press({ key: 'go' })
  expect(commands).toEqual([])
  expect((await ui.find({ key: 'go' }))?.props.label).toBe('交接')
  await ui.unmount()
})
