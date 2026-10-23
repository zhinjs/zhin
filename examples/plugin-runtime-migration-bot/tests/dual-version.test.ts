import { describe, expect, it, vi } from 'vitest';
import { MiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { createCapabilitySlot, rootPluginId } from 'zhin.js/plugin-runtime';
import nextHello from '../commands/hello/[name]/index.js';
import statusCard from '../components/status-card/index.js';
import audit from '../middlewares/audit/index.js';

describe('Plugin Runtime migration result', () => {
  it('executes the migrated command definition', async () => {
    const message = {
      $content: [{ type: 'text', data: { text: 'hello Alice' } }],
    };
    const nextResult = await nextHello.execute({
      input: message,
      args: [],
      params: { name: 'Alice' },
    } as never);

    expect(nextResult).toBe('hello Alice');
  });

  it('keeps extracted middleware and component definitions executable', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({ owner, feature: middlewareFeatureId, localName: 'audit',
      source: '/middlewares/audit/index.ts', definition: audit });
    const middleware = new MiddlewareIndex([slot], {
      generation: 1, root: owner,
      tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'migration-example',
        packageRoot: '/migration-example', children: [] }]]),
      config: new Map([[owner, {}]]), resources: new Map([[owner, new Map()]]),
      capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    });
    const terminal = vi.fn(async () => undefined);
    // The executor owns next() and its opaque continuation, just as in the running plugin.
    await middleware.run({ id: 'message-1' }, terminal);

    expect(terminal).toHaveBeenCalledOnce();
    expect(await statusCard.render({ label: 'ready' }, {} as never)).toBe('ready');
  });
});
