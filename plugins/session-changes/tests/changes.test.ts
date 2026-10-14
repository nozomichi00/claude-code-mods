import { describe, expect, test } from 'claude-code/testing'

import {
  addTask, byRecent, clipDiff, displayPath, editsInBudget, fileKey, fitStart, fromTodoWrite,
  progress, recordEdit, totals, updateTask, visibleTodos,
} from '../hooks/changes'
import type { EditRecord } from '../hooks/changes'

const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }

const edit = (over: Partial<EditRecord>): EditRecord => ({
  path: 'C:\\work\\demo\\a.ts', tool: 'Edit', at: 1, before: 'old\n', isCreated: false, patch: [hunk], ...over,
})

describe('paths', () => {
  test('treats slash and drive-letter case variants as one file', async () => {
    expect(fileKey('C:\\Work\\A.ts')).toBe(fileKey('c:/work/a.ts'))
    expect(fileKey('/home/me/A.ts')).toBe('/home/me/A.ts')
  })

  test('shows paths under the project folder relative to it', async () => {
    expect(displayPath('C:\\work\\demo\\src\\a.ts', 'C:\\work\\demo')).toBe('src/a.ts')
    expect(displayPath('D:\\other\\b.ts', 'C:\\work\\demo')).toBe('D:/other/b.ts')
  })

  test('cuts long names from the front and counts CJK as two columns', async () => {
    expect(fitStart('abcdefgh', 5)).toBe('…efgh')
    expect(fitStart('資料夾/待補資料.md', 9)).toBe('…資料.md')
  })
})

describe('recordEdit', () => {
  test('appends later edits to the same file and keeps the first base', async () => {
    let files = recordEdit([], edit({ at: 1, before: 'v1' }))
    files = recordEdit(files, edit({ path: 'c:/work/demo/a.ts', at: 2, before: 'v2' }))
    expect(files.length).toBe(1)
    expect(files[0]?.base).toBe('v1')
    expect(files[0]?.edits.length).toBe(2)
    expect(files[0]?.lastAt).toBe(2)
    expect(totals(files[0]!)).toEqual({ added: 2, removed: 2 })
  })

  test('builds an all-added diff when Write creates a file without a patch', async () => {
    const files = recordEdit([], edit({ tool: 'Write', isCreated: true, before: '', patch: [], content: 'x\ny\n' }))
    expect(files[0]?.base).toBe('')
    expect(files[0]?.edits[0]?.diff).toBe('@@ -0,0 +1,2 @@\n+x\n+y')
    expect(files[0]?.edits[0]?.added).toBe(2)
  })

  test('notes an edit the tool gave no diff for because the file was too large', async () => {
    const files = recordEdit([], edit({ tool: 'Write', before: null, patch: [] }))
    expect(files[0]?.base).toBe(null)
    expect(files[0]?.edits[0]?.note).toBe('原檔太大，工具沒有提供 diff')
  })

  test('lists the most recently changed file first', async () => {
    let files = recordEdit([], edit({ path: '/a', at: 1 }))
    files = recordEdit(files, edit({ path: '/b', at: 2 }))
    files = recordEdit(files, edit({ path: '/a', at: 3 }))
    expect(byRecent(files).map(file => file.path)).toEqual(['/a', '/b'])
  })
})

describe('diff budget', () => {
  test('keeps the newest edits that fit and counts the rest as skipped', async () => {
    const edits = [10, 10, 10].map((size, i) => ({ at: i, tool: 'Edit' as const, diff: 'x'.repeat(size), added: 0, removed: 0 }))
    expect(editsInBudget(edits, 25)).toEqual({ shown: [1, 2], skipped: 1 })
    expect(editsInBudget(edits, 5)).toEqual({ shown: [2], skipped: 2 })
  })

  test('clips a long diff at a hunk boundary', async () => {
    const diff = '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d'
    expect(clipDiff(diff, 30)).toEqual({ text: '@@ -1,1 +1,1 @@\n-a\n+b', isClipped: true, isPlain: false })
    expect(clipDiff(diff).isClipped).toBe(false)
  })

  test('falls back to plain text when one hunk alone is over budget', async () => {
    const diff = '@@ -1,3 +1,3 @@\n-aaaa\n+bbbb\n cccc'
    expect(clipDiff(diff, 25)).toEqual({ text: '@@ -1,3 +1,3 @@\n-aaaa', isClipped: true, isPlain: true })
  })

  test('notes an empty new file instead of an unchanged one', async () => {
    const files = recordEdit([], edit({ tool: 'Write', isCreated: true, before: '', patch: [], content: '' }))
    expect(files[0]?.edits[0]?.note).toBe('新建的空檔案')
  })
})

describe('todos', () => {
  test('replaces the whole list on TodoWrite', async () => {
    const todos = fromTodoWrite([
      { content: '寫測試', status: 'completed', activeForm: '正在寫測試' },
      { content: '實作', status: 'in_progress', activeForm: '正在實作' },
    ])
    expect(progress(todos)).toEqual({ done: 1, total: 2 })
  })

  test('flattens newlines and strips control characters the pane would refuse', async () => {
    const [todo] = fromTodoWrite([{ content: 'fix\r\nbug\u001b[31m', status: 'pending', activeForm: 'a\nb' }])
    expect(todo?.content).toBe('fix bug[31m')
    expect(todo?.activeForm).toBe('a b')
    expect(addTask([], '1', 'x\ny', undefined)[0]?.content).toBe('x y')
  })

  test('builds the list from TaskCreate and TaskUpdate, dropping deleted tasks', async () => {
    let todos = addTask([], '1', '讀設定', undefined)
    todos = addTask(todos, '2', '寫程式', '正在寫程式')
    todos = updateTask(todos, { taskId: '1', status: 'completed' })
    todos = updateTask(todos, { taskId: '2', status: 'in_progress', subject: '寫 mod' })
    expect(todos.map(todo => [todo.content, todo.status])).toEqual([['讀設定', 'completed'], ['寫 mod', 'in_progress']])
    expect(todos[0]?.activeForm).toBe('讀設定')
    expect(updateTask(todos, { taskId: '1', status: 'deleted' }).length).toBe(1)
  })

  test('folds completed items once the list is long', async () => {
    const many = fromTodoWrite(Array.from({ length: 10 }, (_, i) => ({
      content: `t${i}`, status: i < 6 ? 'completed' as const : 'pending' as const, activeForm: `t${i}`,
    })))
    const { shown, foldedDone } = visibleTodos(many)
    expect(foldedDone).toBe(6)
    expect(shown.length).toBe(4)
    expect(visibleTodos(many.slice(0, 3)).foldedDone).toBe(0)
  })
})
