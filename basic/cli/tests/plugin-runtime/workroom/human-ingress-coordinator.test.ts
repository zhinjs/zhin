import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomHumanIngressCoordinator, resolveCatalogIngressEndpoint } from '../../../src/plugin-runtime/workroom/human-ingress-coordinator.js';

describe('WorkroomHumanIngressCoordinator', () => {
  it('rejects an aborted generation before creating ingress repositories or timers', async () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const lifecycle = { add: vi.fn() };

    await expect(WorkroomHumanIngressCoordinator.create({
      signal: controller.signal,
      resources: new Scope(rootPluginId()),
      lifecycle: lifecycle as never,
      im: {} as never,
      runtime: {} as never,
      profiles: {} as never,
      persistence: {} as never,
      execution: {} as never,
      resolveDataLifecycleControl: () => undefined,
    })).rejects.toThrow('generation replaced');
    expect(lifecycle.add).not.toHaveBeenCalled();
  });
});

it('routes project-local ingress by exact canonical Endpoint identity instead of the slot-local adapter alias', () => {
 const message = { conversation: { endpoint: { id: 'root\0zhin.adapter\0terminal', adapter: 'terminal' }, kind: 'group' as const, id: 'fixture-space' } };
 const rows = [{ id: message.conversation.endpoint.id, adapter: 'minimal-bot', name: 'terminal' }];
 expect(resolveCatalogIngressEndpoint(message, rows)).toEqual({ adapter: 'minimal-bot', endpoint: 'terminal' });
 expect(resolveCatalogIngressEndpoint(message, [{ ...rows[0]!, id: 'other-owner\0zhin.adapter\0terminal' }])).toBeUndefined();
 expect(resolveCatalogIngressEndpoint(message, [rows[0]!, rows[0]!])).toBeUndefined();
});
