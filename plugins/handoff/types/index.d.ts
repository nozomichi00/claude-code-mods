export type HandoffPhase = 'idle' | 'working'

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      /** 主對話最近一次量到的 Context 百分比；清空後為 null。 */
      contextPercent: number | null
      phase: HandoffPhase
      /** 本段對話用 Edit / Write / NotebookEdit 改過的檔案，依首次修改排序。 */
      files: string[]
    }
  }
}
