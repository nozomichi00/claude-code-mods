export type UsageMeterWindow = { percent: number; resetsAt?: string }

export type UsageMeterSnapshot = {
  contextPercent: number | null
  fiveHour: UsageMeterWindow | null
  sevenDay: UsageMeterWindow | null
  lastResponseAt: number | null
}

/** 本 session 累計的 token：input 含快取讀寫，output 為模型產出。 */
export type UsageMeterTokens = { input: number; output: number }

/** 交接流程：idle 可按，working 正在寫摘要／清空／送出。 */
export type UsageMeterHandoffPhase = 'idle' | 'working'

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      snapshot: UsageMeterSnapshot | null
      tokens: UsageMeterTokens
      now: number
      handoffPhase: UsageMeterHandoffPhase
      /** 本段對話用 Edit / Write / NotebookEdit 改過的檔案，依首次修改排序。 */
      editedFiles: string[]
    }
  }
}
