import { describe, expect, test } from 'claude-code/testing'

import {
  SECTIONS, addFile, buildPrompt, cleanSummary, fileContent, firstMessage, handoffPath, projectName,
  shouldOffer, timestamp,
} from '../hooks/handoff'

describe('shouldOffer', () => {
  test('offers at or above the threshold only', async () => {
    expect(shouldOffer(null, 70)).toBe(false)
    expect(shouldOffer(69, 70)).toBe(false)
    expect(shouldOffer(70, 70)).toBe(true)
  })
})

describe('buildPrompt', () => {
  test('asks for the five fixed sections and lists the tracked files', async () => {
    const prompt = buildPrompt(['C:/proj/a.ts', 'C:/proj/b.ts'])
    for (const section of SECTIONS) expect(prompt).toContain(`## ${section}`)
    expect(prompt).toContain('- C:/proj/a.ts')
    expect(prompt).toContain('不要繼續任務')
  })

  test('says so when no file was tracked', async () => {
    expect(buildPrompt([])).toContain('沒有修改過的檔案')
  })
})

describe('cleanSummary', () => {
  test('unwraps a markdown fence and drops escape and hidden characters', async () => {
    const text = '```markdown\r\n## 目前目標\r\n\x1b[31m做完\x1b[0m\u200b交接\r\n```'
    expect(cleanSummary(text)).toBe('## 目前目標\n做完交接')
  })

  test('keeps plain text, newlines and tabs', async () => {
    expect(cleanSummary('  a\n\tb  ')).toBe('a\n\tb')
  })
})

describe('paths and messages', () => {
  const now = new Date(2026, 9, 12, 9, 5, 7).getTime()

  test('timestamp is local YYYYMMDD-HHMMSS', async () => {
    expect(timestamp(now)).toBe('20261012-090507')
  })

  test('projectName takes the last folder and makes it file-safe', async () => {
    expect(projectName('C:\\Users\\nozom\\my proj\\')).toBe('my_proj')
    expect(projectName('/')).toBe('session')
  })

  test('handoffPath lands under ~/.claude/handoffs with forward slashes', async () => {
    expect(handoffPath('C:\\Users\\nozom', 'C:\\work\\demo', now))
      .toBe('C:/Users/nozom/.claude/handoffs/demo-20261012-090507.md')
  })

  test('fileContent heads the summary with project and time', async () => {
    const text = fileContent('## 目前目標', 'C:/work/demo', now)
    expect(text).toContain('- 專案：C:/work/demo')
    expect(text).toContain('- 時間：2026-10-12 09:05')
    expect(text.endsWith('## 目前目標\n')).toBe(true)
  })

  test('firstMessage points at the file and carries the summary', async () => {
    const message = firstMessage('## 目前目標', 'C:/h.md')
    expect(message).toContain('C:/h.md')
    expect(message.endsWith('## 目前目標')).toBe(true)
  })
})

describe('addFile', () => {
  test('keeps first-seen order and ignores case and slash differences', async () => {
    const once = addFile([], 'C:\\proj\\A.ts')
    const twice = addFile(once, 'c:/proj/a.ts')
    expect(twice).toEqual(['C:\\proj\\A.ts'])
    expect(addFile(twice, 'C:/proj/b.ts')).toEqual(['C:\\proj\\A.ts', 'C:/proj/b.ts'])
  })
})
