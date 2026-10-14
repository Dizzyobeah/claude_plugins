// 'frontier' (Fable) is manual-only: /route fable. The classifier never returns it.
export type Tier = 'simple' | 'standard' | 'complex' | 'frontier'
export type Mode = 'auto' | 'off' | Tier
export type Route = { tier: Tier; isClassifying: boolean }
export type Totals = { tokens: number; cost: number; baseline: number }
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'model-router': { route: Route; totals: Totals; mode: Mode; effortOverride: Effort | null }
  }
}
