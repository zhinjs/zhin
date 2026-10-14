import { workroomHostToken } from '@zhin.js/workroom';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { WorkroomHostPublication } from '../../../src/plugin-runtime/workroom/publication.js';

function foundation() {
  return {
    runtime: {},
    kernel: { controlRun: () => undefined },
    catalog: {},
  } as never;
}

describe('WorkroomHostPublication', () => {
  it('rejects an aborted generation before publishing the Workroom Host port', () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());

    expect(() => new WorkroomHostPublication({
      signal: controller.signal,
      resources,
      foundation: foundation(),
    })).toThrow('generation replaced');
    expect(resources.has(workroomHostToken)).toBe(false);
  });

  it('projects late-bound controls through the already-published Host port', () => {
    const resources = new Scope(rootPluginId());
    const publication = new WorkroomHostPublication({
      signal: new AbortController().signal,
      resources,
      foundation: foundation(),
    });
    const control = {} as never;

    expect(Object.keys(resources.use(workroomHostToken).console).sort()).toEqual([
      'dataLifecycle', 'effectSponsor', 'portfolioSponsor', 'workroom', 'workroomCatalog',
      'workroomControl', 'workroomKnowledge', 'workroomProfiles',
    ]);
    expect(resources.use(workroomHostToken).console.workroomProfiles).toBeUndefined();
    publication.bindWorkroomProfiles(control);
    expect(resources.use(workroomHostToken).console.workroomProfiles).toBe(control);
    expect(() => publication.bindWorkroomProfiles(control)).toThrow(
      'Workroom Profile control is already bound',
    );
  });

  it('treats an absent Data Lifecycle control as a no-op and binds a present one once', () => {
    const resources = new Scope(rootPluginId());
    const publication = new WorkroomHostPublication({
      signal: new AbortController().signal,
      resources,
      foundation: foundation(),
    });
    const lifecycle = {} as never;

    publication.bindDataLifecycle(undefined);
    expect(publication.resolveDataLifecycle()).toBeUndefined();
    publication.bindDataLifecycle(lifecycle);
    expect(publication.resolveDataLifecycle()).toBe(lifecycle);
    expect(resources.use(workroomHostToken).console.dataLifecycle).toBe(lifecycle);
    expect(() => publication.bindDataLifecycle(lifecycle)).toThrow('already bound');
  });
});
