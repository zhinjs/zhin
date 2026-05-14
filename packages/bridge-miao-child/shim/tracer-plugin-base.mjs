/**
 * Minimal H1 tracer plugin base (not full Yunzai/Miao API).
 * Real Miao/Yunzai plugins use a larger surface; this package is for Bridge v1 IPC tracing only.
 */
export class MiaoTracerPluginBase {
  /**
   * @param {{ glueKey: { botId: string; ecosystem: string; instanceId: string }; context: string }} ctx
   */
  constructor(ctx) {
    this.glueKey = ctx.glueKey
    this.context = ctx.context
  }
}
