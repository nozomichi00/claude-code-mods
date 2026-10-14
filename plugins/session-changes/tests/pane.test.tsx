import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

const NOW = new Date(2026, 9, 13, 14, 5).getTime()
const FILE = 'C:\\work\\demo\\src\\app.ts'

const pane = {
  component: 'Pane' as const,
  requestId: 'session-changes',
  props: {
    title: '變更', isFocused: true, bodyColumns: 60, placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
}

/** 引擎這一層：Edit 依 isFailing 成功或失敗，讀檔回傳 disk 的內容。 */
function engine(on: On, state: { isFailing: boolean; disk: string }) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('fs.read', () => ({ value: state.disk }))
  on('tool.call', { tool: 'Edit' }, ($, e) => (state.isFailing
    ? { result: 'String to replace not found', isError: true }
    : {
      result: {
        filePath: e.file_path, oldString: e.old_string, newString: e.new_string,
        originalFile: 'const a = 1\nconst b = 2\n', userModified: false, replaceAll: false,
        structuredPatch: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-const b = 2', '+const b = 3'] }],
      },
    }))
}

async function start($: Parameters<TestBody>[0], on: On) {
  mock.clock(on, { now: NOW })
  const state = { isFailing: false, disk: 'const a = 1\nconst b = 3\n' }
  engine(on, state)
  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })
  return state
}

const editCall = { tool: 'Edit', file_path: FILE, old_string: 'const b = 2', new_string: 'const b = 3' } as const

test('lists only successful edits in the pane', async ($, on) => {
  const state = await start($, on)
  await $.tool.call(editCall)
  state.isFailing = true
  await $.tool.call({ ...editCall, file_path: 'C:\\work\\demo\\failed.ts' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-changes', surface, ...pane })
    expect(await ui.find({ type: 'Text', text: /已改檔案 \(1\)/ })).toBeDefined()
    expect(await ui.find({ key: 'file:c:/work/demo/src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file:c:/work/demo/failed.ts' })).toBeUndefined()
    await ui.unmount()
  }
})

test('opens the per-edit diff, switches to the cumulative diff and goes back', async ($, on) => {
  await start($, on)
  await $.tool.call(editCall)

  const ui = await $.ui.mount({ plugin: 'session-changes', surface: 'terminal', ...pane })
  await ui.press({ key: 'file:c:/work/demo/src/app.ts' })
  expect(await ui.find({ type: 'Text', text: /第 1 次/ })).toBeDefined()
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -2,1 +2,1 @@\n-const b = 2\n+const b = 3')

  await ui.press({ key: 'mode-total' })
  expect(await ui.find({ type: 'Text', text: /與第一次修改前相比/ })).toBeDefined()
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3')

  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /已改檔案 \(1\)/ })).toBeDefined()
  await ui.unmount()
})

const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 3 }, view: {} },
}

test('opens the pane once at the start under the fullscreen layout, never on the main screen', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opens: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })
  await $.session.start({ cwd: 'C:\\work\\demo', surface: 'terminal', isInteractive: true })

  const main = await $.ui.mount({ plugin: 'session-changes', surface: 'terminal', ...band, viewport: { columns: 150, rows: 40, isFullscreen: false } })
  await clock.advance(10)
  expect(opens).toEqual([])
  await main.unmount()

  for (let i = 0; i < 2; i++) {
    const full = await $.ui.mount({ plugin: 'session-changes', surface: 'terminal', ...band, viewport: { columns: 150, rows: 40, isFullscreen: true } })
    expect(await full.find({ type: 'Text', text: 'below' })).toBeDefined()
    await clock.advance(10)
    await full.unmount()
  }
  expect(opens).toEqual(['session-changes'])
})

test('clears files on /clear', async ($, on) => {
  await start($, on)
  await $.tool.call(editCall)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ plugin: 'session-changes', surface: 'terminal', ...pane })
  expect(await ui.find({ type: 'Text', text: /已改檔案 \(0\)/ })).toBeDefined()
  await ui.unmount()
})
