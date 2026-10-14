// 純資料處理：記錄 Edit／Write、路徑與寬度計算。

import { cleanLine, oneLine, splitLines } from './diff'
import type { SessionChangesEdit, SessionChangesFile } from '../types'

export type PatchHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: readonly string[]
}

export type EditRecord = {
  path: string
  tool: 'Edit' | 'Write'
  at: number
  agentId?: string
  /** 這次修改前的內容；新檔為 ''，拿不到為 null。 */
  before: string | null
  isCreated: boolean
  patch: readonly PatchHunk[]
  /** Write 建新檔時工具不一定給 patch，用寫入內容補出整檔新增。 */
  content?: string
}

// 一個畫面最多畫約 10 萬字元，diff 留一點空間給標題與按鈕
export const DIFF_BUDGET = 90_000

/** 同一檔案的不同寫法（斜線、Windows 磁碟路徑大小寫）視為同一個。 */
export function fileKey(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return /^[a-zA-Z]:\//.test(slashed) ? slashed.toLowerCase() : slashed
}

/** 在專案資料夾底下的顯示相對路徑，其餘顯示完整路徑。 */
export function displayPath(path: string, cwd: string): string {
  const slashed = oneLine(path.replace(/\\/g, '/'))
  const root = fileKey(cwd).replace(/\/+$/, '')
  return root !== '' && fileKey(path).startsWith(root + '/') ? slashed.slice(root.length + 1) : slashed
}

export function patchToDiff(patch: readonly PatchHunk[]): Pick<SessionChangesEdit, 'diff' | 'added' | 'removed'> {
  const hunks = patch.map(h => [
    `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    ...h.lines.map(line => cleanLine(line)),
  ].join('\n'))
  const lines = patch.flatMap(h => h.lines)
  return {
    diff: hunks.join('\n'),
    added: lines.filter(line => line.startsWith('+')).length,
    removed: lines.filter(line => line.startsWith('-')).length,
  }
}

function createdDiff(content: string): Pick<SessionChangesEdit, 'diff' | 'added' | 'removed'> {
  const lines = splitLines(content)
  if (lines.length === 0) return { diff: '', added: 0, removed: 0 }
  return {
    diff: [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => '+' + cleanLine(line))].join('\n'),
    added: lines.length,
    removed: 0,
  }
}

function emptyNote(record: EditRecord): string {
  if (record.before === null) return '原檔太大，工具沒有提供 diff'
  return record.isCreated ? '新建的空檔案' : '內容沒有變動'
}

function toEdit(record: EditRecord): SessionChangesEdit {
  const fromPatch = record.patch.length > 0 || record.content === undefined || !record.isCreated
  const body = fromPatch ? patchToDiff(record.patch) : createdDiff(record.content ?? '')
  const note = body.diff === '' ? emptyNote(record) : undefined
  return {
    at: record.at,
    tool: record.tool,
    ...(record.agentId === undefined ? {} : { agentId: record.agentId }),
    ...body,
    ...(note === undefined ? {} : { note }),
  }
}

/** 加入一次修改：已記錄的檔案往後接，新檔案以這次修改前的內容作累計基準。 */
export function recordEdit(files: readonly SessionChangesFile[], record: EditRecord): SessionChangesFile[] {
  const key = fileKey(record.path)
  const edit = toEdit(record)
  const existing = files.find(file => file.key === key)
  if (existing === undefined) {
    const created: SessionChangesFile = {
      key,
      path: record.path,
      isCreated: record.isCreated,
      base: record.isCreated ? '' : record.before,
      edits: [edit],
      lastAt: record.at,
    }
    return [...files, created]
  }
  return files.map(file => (file.key === key ? { ...file, edits: [...file.edits, edit], lastAt: record.at } : file))
}

/** 最近修改的排最前面。 */
export function byRecent(files: readonly SessionChangesFile[]): SessionChangesFile[] {
  return [...files].sort((a, b) => b.lastAt - a.lastAt)
}

export function totals(file: SessionChangesFile): { added: number; removed: number } {
  return file.edits.reduce((sum, edit) => ({ added: sum.added + edit.added, removed: sum.removed + edit.removed }), { added: 0, removed: 0 })
}

export function hasAgentEdit(file: SessionChangesFile): boolean {
  return file.edits.some(edit => edit.agentId !== undefined)
}

/** 逐次檢視：由新往舊放，超出預算的較早修改省略。回傳依時間排序的 index 與省略數。 */
export function editsInBudget(edits: readonly SessionChangesEdit[], budget = DIFF_BUDGET): { shown: number[]; skipped: number } {
  const shown: number[] = []
  let used = 0
  for (let i = edits.length - 1; i >= 0; i--) {
    used += edits[i]!.diff.length
    if (used > budget && shown.length > 0) break
    shown.unshift(i)
  }
  return { shown, skipped: edits.length - shown.length }
}

export type ClippedDiff = { text: string; isClipped: boolean; isPlain: boolean }

/** 單一 diff 超出預算時，在片段邊界截斷。 */
export function clipDiff(diff: string, budget = DIFF_BUDGET): ClippedDiff {
  if (diff.length <= budget) return { text: diff, isClipped: false, isPlain: false }
  const cut = diff.lastIndexOf('\n@@', budget)
  if (cut > 0) return { text: diff.slice(0, cut), isClipped: true, isPlain: false }
  // 單一片段就超過：片段標頭的行數不再相符、無法當 diff 解析，改成純文字顯示
  const lineEnd = diff.lastIndexOf('\n', budget)
  return { text: diff.slice(0, lineEnd > 0 ? lineEnd : budget), isClipped: true, isPlain: true }
}

// ── 寬度 ──────────────────────────────────────────────────────────

/** 終端機顯示寬度：中日韓全形字算 2 欄。 */
export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  const isWide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)
  return isWide ? 2 : 1
}

export function textWidth(text: string): number {
  return [...text].reduce((sum, char) => sum + charWidth(char), 0)
}

/** 太長就從前面截掉，保留檔名那一端。 */
export function fitStart(text: string, columns: number): string {
  if (textWidth(text) <= columns) return text
  if (columns <= 1) return '…'
  const chars = [...text]
  let width = 1
  let from = chars.length
  while (from > 0 && width + charWidth(chars[from - 1]!) <= columns) {
    from--
    width += charWidth(chars[from]!)
  }
  return '…' + chars.slice(from).join('')
}

export function clockTime(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
