import { describe, expect, it, vi } from 'vitest';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js';
import { MiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
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
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root, feature: middlewareFeatureId, localName: 'audit',
      source: '/middlewares/audit/index.ts', definition: audit,
    });
    const snapshot: RuntimeSnapshot = {
      generation: 1, root,
      tree: new Map([[root, {
        id: root, instanceKey: 'root', packageName: '@test/migration',
        packageRoot: '/project', children: [],
      }]]),
      config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]),
      capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    };
    const terminal = vi.fn(async () => undefined);
    // Execute with the real frame-scoped continuation returned by next().
    await new MiddlewareIndex([slot], snapshot).run({ id: 'message-1' }, terminal);

    expect(terminal).toHaveBeenCalledOnce();
    expect(await statusCard.render({ label: 'ready' }, {} as never)).toBe('ready');
  });
});
