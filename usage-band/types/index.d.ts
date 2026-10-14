export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// Tokens per model id for one calendar day (YYYY-MM-DD).
export type Daily = { date: string; byModel: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limit[]; daily: Daily }
  }
}
