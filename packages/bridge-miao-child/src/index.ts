/** Env var: JSON string matching {@link MiaoTracerChildConfig} for `bin/miao-tracer-child.mjs`. */
export const MIAO_TRACER_CONFIG_ENV = 'ZHIN_BRIDGE_MIAO_CONFIG' as const

/**
 * O1-style explicit plugin allowlist (absolute `.mjs` paths recommended).
 * Loaded only by the tracer child; does not imply zhin Core loads Yunzai/Miao at runtime.
 */
export interface MiaoTracerChildConfig {
  pluginAllowlist: string[]
  glueKey: { botId: string; ecosystem: string; instanceId: string }
  /** Outbound `payload.context` (e.g. `miao`). */
  context?: string
}
