import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { unifiedBetween } from './diff'
import {
  addTask, byRecent, clipDiff, clockTime, displayPath, editsInBudget, fileKey, fitStart, fromTodoWrite,
  hasAgentEdit, progress, recordEdit, totals, updateTask, visibleTodos,
} from './changes'
import type { EditRecord } from './changes'
import type {
  SessionChangesDiffMode, SessionChangesFile, SessionChangesTodo, SessionChangesTotal, SessionChangesView,
} from '../types'

const PANE = 'session-changes'
const TITLE = '變更'
const COMMAND = 'changes'

// 與 usage-meter 相同的 Catppuccin Macchiato 色系
const ACCENT = '#8AADF4'
const GREEN = '#A6DA95'
const RED = '#ED8796'
const TRACK = '#494D64'
const PROGRESS_CELLS = 10

const files = atom({ plugin: 'session-changes', key: 'files' } as const, [])
const todos = atom({ plugin: 'session-changes', key: 'todos' } as const, [])
const view = atom({ plugin: 'session-changes', key: 'view' } as const, { kind: 'list' })
const total = atom({ plugin: 'session-changes', key: 'total' } as const, null)
const cwd = atom({ plugin: 'session-changes', key: 'cwd' } as const, '')
const hasAutoOpened = atom({ plugin: 'session-changes', key: 'hasAutoOpened' } as const, false)

// 版面要等輸入框上方那一列第一次繪製才知道；繪製中不能寫狀態，所以排到繪製之後再開
let isOpenScheduled = false

/** 全螢幕版面下 session 一開始就打開；使用者在這個 session 關掉後不再自動開。 */
async function autoOpen($: EngineInterface): Promise<void> {
  if (await read($, hasAutoOpened)) return
  await update($, hasAutoOpened, () => true)
  await $.ui.open({ id: PANE, title: TITLE })
}

async function computeTotal($: EngineInterface, key: string): Promise<void> {
  const file = (await read($, files)).find(one => one.key === key)
  if (file === undefined) return
  const result = await totalOf($, file)
  // 讀檔期間使用者可能已切到別的檔案或模式，過時的結果不寫入
  const latest = await read($, view)
  if (latest.kind !== 'diff' || latest.mode !== 'total' || latest.key !== key) return
  await update($, total, () => result)
}

async function totalOf($: EngineInterface, file: SessionChangesFile): Promise<SessionChangesTotal> {
  const empty = { key: file.key, diff: '', added: 0, removed: 0 }
  if (file.base === null) return { ...empty, note: '第一次修改前的原檔太大，無法計算累計 diff' }
  let current: string
  try {
    current = await $.fs.read(file.path)
  } catch {
    return { ...empty, note: '檔案已不存在，或超過 4 MiB 無法讀取' }
  }
  const diff = unifiedBetween(file.base, current)
  if (diff === null) return { ...empty, note: '差異太大，無法計算累計 diff' }
  if (diff.text === '') return { ...empty, note: '與本 session 第一次修改前相同' }
  return { key: file.key, diff: diff.text, added: diff.added, removed: diff.removed }
}

async function onEdit($: EngineInterface, record: EditRecord): Promise<void> {
  await update($, files, list => recordEdit(list, record))
  const current = await read($, view)
  if (current.kind === 'diff' && current.mode === 'total' && current.key === fileKey(record.path)) {
    await computeTotal($, current.key)
  }
}

async function onTodos($: EngineInterface, change: (list: SessionChangesTodo[]) => SessionChangesTodo[]): Promise<void> {
  await update($, todos, change)
}

async function showDiff($: EngineInterface, key: string, mode: SessionChangesDiffMode): Promise<void> {
  await update($, view, (): SessionChangesView => ({ kind: 'diff', key, mode }))
  if (mode === 'total') await computeTotal($, key)
}

async function reset($: EngineInterface): Promise<void> {
  await update($, files, () => [])
  await update($, todos, () => [])
  await update($, view, () => ({ kind: 'list' }))
  await update($, total, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: '開關「變更」側邊面板：本 session 改過的檔案與 TO DO 進度' })
    await update($, cwd, () => e.cwd)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isPlaced === true) {
      await $.ui.close({ id: PANE })
      return { text: '已關閉變更面板。' }
    }
    await update($, hasAutoOpened, () => true)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '已打開變更面板。' }
  })

  // ── 記錄修改 ──────────────────────────────────────────────────
  // 工具執行完才記；失敗、被擋下、留給機器擁有者審核（staged）的都不算。
  // 記錄出錯時 .catch 交回工具原本的結果（已執行過的不會重跑），不影響工具本身

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result.staged === true) return ran
    await onEdit($, {
      path: ran.result.filePath, tool: 'Edit', at: await $.clock.now(), agentId: e.agentId,
      before: ran.result.originalFile, isCreated: false, patch: ran.result.structuredPatch,
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const isCreated = ran.result.type === 'create'
    await onEdit($, {
      path: ran.result.filePath, tool: 'Write', at: await $.clock.now(), agentId: e.agentId,
      before: isCreated ? '' : ran.result.originalFile, isCreated, patch: ran.result.structuredPatch,
      content: ran.result.content,
    })
    return ran
  }).catch(($, e, next) => next(e))

  // ── TO DO：舊版 TodoWrite 送整份清單，新版 Task 工具一次改一項 ──

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await onTodos($, () => fromTodoWrite(e.todos))
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const id = ran.result.task.id
      await onTodos($, list => addTask(list, id, e.subject, e.activeForm))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.success) {
      await onTodos($, list => updateTask(list, e))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 只是讀版面資訊，畫面交給下層照常畫；主畫面版面會擠掉輸入框上方的空間，不自動開
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.viewport?.isFullscreen === true && !isOpenScheduled) {
      isOpenScheduled = true
      $.clock.after(0, () => autoOpen($))
    }
    return next(e)
  })

  // ── 面板 ──────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const columns = Math.max(20, e.props.bodyColumns)
    const [fileList, todoList, current, root] = await Promise.all([read($, files), read($, todos), read($, view), read($, cwd)])
    const opened = current.kind === 'diff' ? fileList.find(file => file.key === current.key) : undefined

    if (current.kind === 'diff' && opened !== undefined) {
      const sum = totals(opened)
      const back = () => update($, view, () => ({ kind: 'list' }))
      const header = (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" onPress={back}>← 返回</Button>
            <Button key="mode-each" variant={current.mode === 'each' ? 'primary' : 'secondary'}
              onPress={() => showDiff($, opened.key, 'each')}>逐次</Button>
            <Button key="mode-total" variant={current.mode === 'total' ? 'primary' : 'secondary'}
              onPress={() => showDiff($, opened.key, 'total')}>累計</Button>
          </Box>
          <Text bold wrap="truncate-start">{fitStart(displayPath(opened.path, root), columns)}</Text>
        </Box>
      )

      if (current.mode === 'total') {
        const result = await read($, total)
        const isReady = result !== null && result.key === opened.key
        const clipped = isReady ? clipDiff(result.diff) : { text: '', isClipped: false, isPlain: false }
        return (
          <Box flexDirection="column">
            {header}
            {!isReady && <Text dimColor>計算中…</Text>}
            {isReady && result.note !== undefined && <Text dimColor>{result.note}</Text>}
            {isReady && result.note === undefined && (
              <Text>
                <Text dimColor>與第一次修改前相比 </Text>
                <Text color={GREEN}>+{result.added}</Text> <Text color={RED}>−{result.removed}</Text>
              </Text>
            )}
            {clipped.text !== '' && <Code format={clipped.isPlain ? 'source' : 'diff'} source={clipped.text} path={opened.path} />}
            {clipped.isClipped && <Text dimColor>diff 太長，後面省略</Text>}
          </Box>
        )
      }

      const { shown, skipped } = editsInBudget(opened.edits)
      return (
        <Box flexDirection="column">
          {header}
          <Text>
            <Text dimColor>共 {opened.edits.length} 次修改 </Text>
            <Text color={GREEN}>+{sum.added}</Text> <Text color={RED}>−{sum.removed}</Text>
          </Text>
          {skipped > 0 && <Text dimColor>較早的 {skipped} 次修改省略</Text>}
          {shown.map(i => {
            const edit = opened.edits[i]!
            const clipped = clipDiff(edit.diff)
            return (
              <Box key={`edit-${i}`} flexDirection="column" marginTop={1}>
                <Text>
                  <Text color={ACCENT}>第 {i + 1} 次</Text>
                  <Text dimColor> · {clockTime(edit.at)} · {edit.tool}{edit.agentId === undefined ? '' : ' · agent'} </Text>
                  <Text color={GREEN}>+{edit.added}</Text> <Text color={RED}>−{edit.removed}</Text>
                </Text>
                {edit.note !== undefined && <Text dimColor>{edit.note}</Text>}
                {clipped.text !== '' && <Code format={clipped.isPlain ? 'source' : 'diff'} source={clipped.text} path={opened.path} />}
                {clipped.isClipped && <Text dimColor>diff 太長，後面省略</Text>}
              </Box>
            )
          })}
        </Box>
      )
    }

    // 清單：上半 TO DO，下半改過的檔案
    const { done, total: count } = progress(todoList)
    const filled = count === 0 ? 0 : Math.round((done / count) * PROGRESS_CELLS)
    const { shown: todoRows, foldedDone } = visibleTodos(todoList)
    const recent = byRecent(fileList)

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>TO DO </Text>
          {count > 0 && <Text color={GREEN}>{'▰'.repeat(filled)}</Text>}
          {count > 0 && <Text color={TRACK}>{'▱'.repeat(PROGRESS_CELLS - filled)}</Text>}
          {count > 0 && <Text dimColor> {done}/{count}</Text>}
        </Text>
        {count === 0 && <Text dimColor>尚無 TO DO</Text>}
        {foldedDone > 0 && <Text color={GREEN} dimColor>✓ 已完成 {foldedDone} 項</Text>}
        {todoRows.map(todo => todoRow(Text, todo, columns))}

        <Text color={TRACK}>{'─'.repeat(columns)}</Text>
        <Text bold>已改檔案 ({recent.length})</Text>
        {recent.length === 0 && <Text dimColor>尚未用 Edit／Write 改過檔案</Text>}
        {recent.map(file => {
          const sum = totals(file)
          const tail = ` +${sum.added} −${sum.removed}${file.edits.length > 1 ? ` ×${file.edits.length}` : ''} ${clockTime(file.lastAt)}${hasAgentEdit(file) ? ' [agent]' : ''}`
          const name = fitStart(displayPath(file.path, root), Math.max(8, columns - tail.length - 3))
          return (
            <Button key={`file:${file.key}`} plain onPress={() => showDiff($, file.key, 'each')}>
              <Text color={file.isCreated ? GREEN : ACCENT}>{file.isCreated ? 'A' : 'M'}</Text> {name}
              <Text color={GREEN}> +{sum.added}</Text>
              <Text color={RED}> −{sum.removed}</Text>
              <Text dimColor>{file.edits.length > 1 ? ` ×${file.edits.length}` : ''} {clockTime(file.lastAt)}{hasAgentEdit(file) ? ' [agent]' : ''}</Text>
            </Button>
          )
        })}
      </Box>
    )
  })
}

type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text']

function todoRow(Text: TextElement, todo: SessionChangesTodo, columns: number) {
  const width = Math.max(8, columns - 2)
  if (todo.status === 'completed') {
    return <Text key={`todo:${todo.id}`} dimColor wrap="truncate-end"><Text color={GREEN}>✓</Text> {fitStart(todo.content, width)}</Text>
  }
  if (todo.status === 'in_progress') {
    return <Text key={`todo:${todo.id}`} bold color={ACCENT} wrap="truncate-end">◐ {todo.activeForm}</Text>
  }
  return <Text key={`todo:${todo.id}`} wrap="truncate-end">○ {todo.content}</Text>
}
