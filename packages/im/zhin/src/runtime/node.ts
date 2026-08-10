import type { BootstrapNodeResult, BootstrapOptions } from './types.js';

/**
 * @deprecated **已删除**。请使用 `zhin runtime start`（Plugin Runtime）。
 * @throws 总是抛出——仅保留签名供编译期过渡。
 */
export async function bootstrapNode(_options?: BootstrapOptions): Promise<BootstrapNodeResult> {
  throw new Error(
    'bootstrapNode() has been removed. Use `zhin runtime start` instead. '
    + 'See docs/contributing/public-api-surface.md',
  );
}
