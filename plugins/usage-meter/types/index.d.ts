export type UsageMeterWindow = { percent: number; resetsAt?: string }

export type UsageMeterSnapshot = {
  model: string | null
  contextPercent: number | null
  fiveHour: UsageMeterWindow | null
  sevenDay: UsageMeterWindow | null
  lastResponseAt: number | null
}

/** 本 session 累計的 token：input 含快取讀寫，output 為模型產出。 */
export type UsageMeterTokens = { input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { snapshot: UsageMeterSnapshot | null; tokens: UsageMeterTokens; now: number }
  }
}
