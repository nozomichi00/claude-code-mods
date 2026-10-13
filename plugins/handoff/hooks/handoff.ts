// 交接流程的純函式：組 fork 提示、清理摘要、檔名與第一句訊息。

export const SECTIONS = ['目前目標', '已完成', '尚未完成', '改過的檔案', '注意事項'] as const

const ESCAPE_SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
// 保留換行與 tab，其餘控制字元、格式字元、私用區與 Unicode tag 一律去掉
const UNSEEN = /[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}\p{Co}\u{E0000}-\u{E007F}]/gu
const FENCE = /^```[\w-]*\n([\s\S]*?)\n```$/

export function shouldOffer(contextPercent: number | null, threshold: number): boolean {
  return contextPercent !== null && contextPercent >= threshold
}

export function buildPrompt(files: readonly string[]): string {
  const fileList = files.length === 0
    ? '（工具紀錄中沒有修改過的檔案；若對話裡有提到改過的檔案，依對話補上）'
    : files.map(f => `- ${f}`).join('\n')
  return [
    '不要繼續任務。請替接手這份工作的新對話寫一份交接摘要：繁體中文、Markdown，只輸出摘要本身，不要前言或結語。',
    `依序包含以下 ${SECTIONS.length} 節，標題固定用「## 」開頭：`,
    SECTIONS.map(s => `## ${s}`).join('\n'),
    '',
    '寫法：',
    '- 目前目標：使用者要達成什麼，以及目前做到哪一步。',
    '- 已完成／尚未完成：條列、具體（檔名、函式、指令、commit），尚未完成依優先順序排列。',
    '- 改過的檔案：以下清單來自工具呼叫紀錄，以它為準，每個檔案補一句改了什麼：',
    fileList,
    '- 注意事項：使用者的偏好與裁定、踩過的坑、尚未驗證的假設、不能做的事。',
    '讓沒看過這段對話的人能直接接手。',
  ].join('\n')
}

export function cleanSummary(text: string): string {
  const stripped = text
    .replace(/\r\n?/g, '\n')
    .replace(ESCAPE_SEQUENCES, '')
    .replace(UNSEEN, '')
    .trim()
  const fenced = FENCE.exec(stripped)
  return (fenced?.[1] ?? stripped).trim()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function timestamp(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function projectName(cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const safe = base.replace(/[^\w.-]+/g, '_')
  return safe === '' ? 'session' : safe
}

/** ~/.claude/handoffs/<專案>-<時間>.md，一律用正斜線。 */
export function handoffPath(home: string, cwd: string, now: number): string {
  const root = home.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${root}/.claude/handoffs/${projectName(cwd)}-${timestamp(now)}.md`
}

export function fileContent(summary: string, cwd: string, now: number): string {
  const d = new Date(now)
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `# 交接摘要\n\n- 專案：${cwd}\n- 時間：${when}\n\n${summary}\n`
}

export function firstMessage(summary: string, path: string): string {
  return `以下是上一段對話的交接摘要（完整檔案：${path}）。請先讀完並用幾句話確認目前狀態，等我指示再繼續。\n\n${summary}`
}

/** 依首次出現排序並去重，Windows 路徑大小寫不分。 */
export function addFile(files: readonly string[], path: string): string[] {
  const key = path.replace(/\\/g, '/').toLowerCase()
  return files.some(f => f.replace(/\\/g, '/').toLowerCase() === key) ? [...files] : [...files, path]
}
