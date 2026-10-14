/** 一次 Edit／Write：當次的 diff（unified 片段）與增刪行數。 */
export type SessionChangesEdit = {
  at: number
  tool: 'Edit' | 'Write'
  /** 子代理改的才有，主對話為 undefined。 */
  agentId?: string
  diff: string
  added: number
  removed: number
  /** 工具沒給 diff 時的說明（例如原檔太大）。 */
  note?: string
}

/** 一個改過的檔案，key 為正規化路徑（斜線統一、Windows 磁碟路徑轉小寫）。 */
export type SessionChangesFile = {
  key: string
  path: string
  isCreated: boolean
  /** 本 session 第一次修改前的內容，累計 diff 的基準；拿不到（原檔太大）為 null。 */
  base: string | null
  edits: SessionChangesEdit[]
  lastAt: number
}

export type SessionChangesTodoStatus = 'pending' | 'in_progress' | 'completed'

export type SessionChangesTodo = {
  id: string
  content: string
  activeForm: string
  status: SessionChangesTodoStatus
}

export type SessionChangesDiffMode = 'each' | 'total'

export type SessionChangesView =
  | { kind: 'list' }
  | { kind: 'diff'; key: string; mode: SessionChangesDiffMode }

/** 累計 diff 的計算結果，對應 view 裡那個檔案。 */
export type SessionChangesTotal = {
  key: string
  diff: string
  added: number
  removed: number
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-changes': {
      files: SessionChangesFile[]
      todos: SessionChangesTodo[]
      view: SessionChangesView
      total: SessionChangesTotal | null
      cwd: string
      /** 已自動開過面板；使用者關掉後不再自動打開。 */
      hasAutoOpened: boolean
    }
  }
}
