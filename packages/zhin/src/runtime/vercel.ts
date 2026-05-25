import { bootstrapEdgeCore, type BootstrapEdgeOptions } from './edge-core.js';

export { bootstrapEdgeCore, type BootstrapEdgeOptions };
export type { BootstrapEdgeResult, BootstrapOptions } from './types.js';

/** Vercel Edge：返回 `{ fetch }` 供 `export default` 使用 */
export async function bootstrapVercel(options: BootstrapEdgeOptions) {
  const rt = await bootstrapEdgeCore(options);
  return { fetch: rt.fetch };
}
