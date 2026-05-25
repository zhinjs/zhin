import { bootstrapEdgeCore, type BootstrapEdgeOptions } from './edge-core.js';

export { bootstrapEdgeCore, type BootstrapEdgeOptions };
export type { BootstrapEdgeResult, BootstrapOptions } from './types.js';

/** Deno Deploy / `deno serve` 入口别名 */
export async function bootstrapDeno(options: BootstrapEdgeOptions) {
  return bootstrapEdgeCore(options);
}
