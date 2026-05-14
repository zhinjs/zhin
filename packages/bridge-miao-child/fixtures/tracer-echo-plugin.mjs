import { MiaoTracerPluginBase } from '../shim/tracer-plugin-base.mjs'

/**
 * Minimal allowlisted plugin: maps a synthetic `event: "message"` dispatch payload to one outbound intent.
 */
export default class TracerEchoPlugin extends MiaoTracerPluginBase {
  /**
   * @param {unknown} payload
   * @param {{ dispatchId: string; emitOutboundIntent: (o: { channel: { type: string; id: string }; content: unknown }) => void }} api
   */
  async onBridgeDispatch(payload, api) {
    if (!payload || typeof payload !== 'object') return
    const p = /** @type {Record<string, unknown>} */ (payload)
    if (p.event !== 'message') return
    const uid = typeof p.user_id === 'string' ? p.user_id : 'user-unknown'
    const text = typeof p.text === 'string' ? p.text : ''
    api.emitOutboundIntent({
      channel: { type: 'private', id: uid },
      content: { text: `miao-tracer:${text}` },
    })
  }
}
