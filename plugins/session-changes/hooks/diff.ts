// 行為單位的 diff：Myers 演算法找最短編輯路徑，再切成 unified diff 片段。
// 累計 diff 用它比對「第一次修改前」與「現在」的檔案內容。

export type DiffOp = { kind: ' ' | '-' | '+'; text: string }

export type UnifiedDiff = { text: string; added: number; removed: number }

const CONTEXT_LINES = 3
// 超過就放棄計算，避免巨大檔案或整檔改寫卡住面板
const MAX_EDIT_DISTANCE = 4_000
const MAX_TOTAL_LINES = 60_000

// Code 元件只接受 tab 與換行兩種控制字元
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g

export function cleanLine(line: string): string {
  return line.replace(CONTROL_CHARS, '')
}

/** 要畫成一行的外來文字（TO DO、路徑）：換行改空白，再去掉控制字元。 */
export function oneLine(text: string): string {
  return cleanLine(text.replace(/\r?\n/g, ' '))
}

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/** 回傳逐行操作；差異太大算不完時回傳 null。 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] | null {
  if (a.length + b.length > MAX_TOTAL_LINES) return null
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB))
  if (middle === null) return null
  const same = (lines: readonly string[]): DiffOp[] => lines.map(text => ({ kind: ' ', text }))
  return [...same(a.slice(0, start)), ...middle, ...same(a.slice(endA))]
}

function myers(a: readonly string[], b: readonly string[]): DiffOp[] | null {
  const n = a.length
  const m = b.length
  if (n + m === 0) return []
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // trace[d]：第 d 步之前的 v，只留 k ∈ [-(d+1), d+1] 這段窗口
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const isDown = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
      let x = isDown ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b, d)
    }
  }
  return null
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[], depth: number): DiffOp[] {
  const ops: DiffOp[] = []
  let x = a.length
  let y = b.length
  for (let d = depth; d > 0; d--) {
    const prev = trace[d]!
    const at = (k: number): number => prev[k + d + 1]!
    const k = x - y
    const isDown = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = isDown ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    const midX = isDown ? prevX : prevX + 1
    while (x > midX) {
      ops.push({ kind: ' ', text: a[x - 1]! })
      x--
      y--
    }
    if (isDown) ops.push({ kind: '+', text: b[prevY]! })
    else ops.push({ kind: '-', text: a[prevX]! })
    x = prevX
    y = prevY
  }
  while (x > 0) {
    ops.push({ kind: ' ', text: a[x - 1]! })
    x--
  }
  return ops.reverse()
}

/** 把逐行操作切成帶 @@ 標頭的片段，前後各留 CONTEXT_LINES 行上下文。 */
export function toUnified(ops: readonly DiffOp[]): UnifiedDiff {
  const changes = ops.flatMap((op, i) => (op.kind === ' ' ? [] : [i]))
  if (changes.length === 0) return { text: '', added: 0, removed: 0 }

  // oldBefore[i]／newBefore[i]：第 i 個操作之前，新舊檔各走了幾行
  const oldBefore: number[] = []
  const newBefore: number[] = []
  let oldCount = 0
  let newCount = 0
  for (const op of ops) {
    oldBefore.push(oldCount)
    newBefore.push(newCount)
    if (op.kind !== '+') oldCount++
    if (op.kind !== '-') newCount++
  }
  oldBefore.push(oldCount)
  newBefore.push(newCount)

  const groups: Array<[number, number]> = []
  for (const i of changes) {
    const last = groups[groups.length - 1]
    if (last !== undefined && i - last[1] <= CONTEXT_LINES * 2 + 1) last[1] = i
    else groups.push([i, i])
  }

  const hunks = groups.map(([first, lastChange]) => {
    const from = Math.max(0, first - CONTEXT_LINES)
    const to = Math.min(ops.length, lastChange + CONTEXT_LINES + 1)
    const oldLines = oldBefore[to]! - oldBefore[from]!
    const newLines = newBefore[to]! - newBefore[from]!
    const oldStart = oldLines === 0 ? oldBefore[from]! : oldBefore[from]! + 1
    const newStart = newLines === 0 ? newBefore[from]! : newBefore[from]! + 1
    const body = ops.slice(from, to).map(op => op.kind + cleanLine(op.text))
    return [`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...body].join('\n')
  })

  return {
    text: hunks.join('\n'),
    added: ops.filter(op => op.kind === '+').length,
    removed: ops.filter(op => op.kind === '-').length,
  }
}

/** 兩份內容的 unified diff；算不出來回傳 null。 */
export function unifiedBetween(before: string, after: string): UnifiedDiff | null {
  const ops = diffLines(splitLines(before), splitLines(after))
  return ops === null ? null : toUnified(ops)
}
