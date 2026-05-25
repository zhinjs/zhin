import { bootstrapEdgeCore, type BootstrapEdgeOptions } from './edge-core.js';

export { bootstrapEdgeCore, type BootstrapEdgeOptions };
export type { BootstrapEdgeResult, BootstrapOptions } from './types.js';

/** Cloudflare Workers：与 Vercel 相同，仅 Fetch（无 WebSocket upgrade） */
export async function bootstrapCloudflare(options: BootstrapEdgeOptions) {
  const rt = await bootstrapEdgeCore(options);
  return { fetch: rt.fetch };
}
