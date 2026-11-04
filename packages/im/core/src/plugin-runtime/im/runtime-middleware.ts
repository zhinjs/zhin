import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { MiddlewareIndex, isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';

/** Runs the generation-owned middleware projection or the terminal directly. */
export async function runRuntimeMiddleware<TInput>(
  snapshot: RuntimeSnapshot,
  input: TInput,
  terminal: () => Promise<void>,
  target: 'inbound' | 'outbound',
): Promise<void> {
  const index = middleware(snapshot);
  if (index) await index.run(input, terminal, target, snapshot);
  else await terminal();
}

function middleware(snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const projection = snapshot.projections.get(middlewareFeatureId);
  return isMiddlewareIndex(projection) ? projection : undefined;
}

/** Legacy outbound middleware sees one complete reply unless its author explicitly supports revisions. */
export function supportsIncrementalOutbound(snapshot: RuntimeSnapshot, adapter: string): boolean {
  return middleware(snapshot)?.list().every(record => record.target !== 'outbound'
    || record.adapter !== undefined && record.adapter !== adapter || record.incremental === true) ?? true;
}
