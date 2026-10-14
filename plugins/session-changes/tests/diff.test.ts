import { describe, expect, test } from 'claude-code/testing'

import { diffLines, splitLines, toUnified, unifiedBetween } from '../hooks/diff'

describe('splitLines', () => {
  test('drops the empty piece after a trailing newline and handles CRLF', async () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
  })
})

describe('unifiedBetween', () => {
  test('returns an empty diff for identical content', async () => {
    expect(unifiedBetween('a\nb\n', 'a\nb\n')).toEqual({ text: '', added: 0, removed: 0 })
  })

  test('marks a changed line with three lines of context around it', async () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n')
    const after = ['1', '2', '3', '4', 'five', '6', '7', '8', '9'].join('\n')
    const diff = unifiedBetween(before, after)
    expect(diff?.text).toBe(['@@ -2,7 +2,7 @@', ' 2', ' 3', ' 4', '-5', '+five', ' 6', ' 7', ' 8'].join('\n'))
    expect(diff?.added).toBe(1)
    expect(diff?.removed).toBe(1)
  })

  test('numbers a whole new file from line one against an empty old side', async () => {
    expect(unifiedBetween('', 'x\ny\n')?.text).toBe(['@@ -0,0 +1,2 @@', '+x', '+y'].join('\n'))
  })

  test('splits far-apart changes into separate hunks', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    const changed = lines.map((line, i) => (i === 1 || i === 27 ? `${line}!` : line))
    const diff = unifiedBetween(lines.join('\n'), changed.join('\n'))
    expect(diff?.text.match(/^@@/gm)?.length).toBe(2)
  })
})

describe('diffLines', () => {
  test('rebuilds both sides from the operations', async () => {
    const a = ['a', 'b', 'c', 'd', 'e']
    const b = ['x', 'b', 'c', 'y', 'e', 'f']
    const ops = diffLines(a, b) ?? []
    expect(ops.filter(op => op.kind !== '+').map(op => op.text)).toEqual(a)
    expect(ops.filter(op => op.kind !== '-').map(op => op.text)).toEqual(b)
  })

  test('strips control characters the Code element refuses', async () => {
    const ops = diffLines(['a'], ['b\u0007'])
    expect(toUnified(ops ?? []).text).toContain('+b')
    expect(toUnified(ops ?? []).text).not.toContain('\u0007')
  })
})
