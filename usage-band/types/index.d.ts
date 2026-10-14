export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// Tokens per model id, from every session's transcripts: today (local day) and the last 7 days.
export type Scan = { at: number; today: Record<string, number>; week: Record<string, number>; isTruncated: boolean }
// Per agent id ('main' for the main loop): this session's tokens and turns.
export type Agents = Record<string, { label: string; model: string; tokens: number; turns: number }>

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limit[]; scan: Scan; agents: Agents; isOff: boolean }
  }
}
