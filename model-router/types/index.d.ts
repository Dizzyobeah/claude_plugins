// 'frontier' (Fable) and 'mythos' are manual-only (/route fable|mythos). The classifier never returns them.
export type Tier = 'simple' | 'standard' | 'complex' | 'frontier' | 'mythos'
export type Mode = 'auto' | 'off' | Tier
export type Route = { tier: Tier; isClassifying: boolean; lastAnswer: string }
export type Totals = { tokens: number; cost: number; baseline: number }
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'model-router': { route: Route; totals: Totals; mode: Mode; effortOverride: Effort | null }
  }
}
