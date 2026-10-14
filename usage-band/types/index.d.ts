export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// Tokens per model id for one calendar day (YYYY-MM-DD).
export type Daily = { date: string; byModel: Record<string, number> }

// Per agent id ('main' for the main loop): this session's tokens and turns.
export type Agents = Record<string, { label: string; model: string; tokens: number; turns: number }>

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limit[]; daily: Daily; isOff: boolean; agents: Agents }
  }
}
