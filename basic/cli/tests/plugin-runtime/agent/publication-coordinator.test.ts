import { agentHostToken } from '@zhin.js/agent/runtime';
import { workroomHostToken } from '@zhin.js/workroom';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { AgentHostPublicationCoordinator } from '../../../src/plugin-runtime/agent/publication-coordinator.js';

describe('AgentHostPublicationCoordinator', () => {
  it('rejects an aborted generation before publishing Host resources', () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());

    expect(() => new AgentHostPublicationCoordinator({
      projectRoot: process.cwd(),
      signal: controller.signal,
      resources,
      processRuntime: {} as never,
      agent: {} as never,
      bootstrapText: '',
    })).toThrow('generation replaced');
    expect(resources.has(agentHostToken)).toBe(false);
    expect(resources.has(workroomHostToken)).toBe(false);
  });

  it('publishes generation-owned Agent ports without Workroom or late-bound controls', () => {
    const resources = new Scope(rootPluginId());
    const history = { page: () => undefined, read: () => undefined, cleanup: () => undefined, health: () => undefined };
    const coordinator = new AgentHostPublicationCoordinator({
      projectRoot: process.cwd(),
      signal: new AbortController().signal,
      resources,
      processRuntime: {} as never,
      agent: {
        service: {
          loopHooks: {},
          getBindingRegistry: () => ({ getBinding: () => undefined }),
        },
        agent: {
          resourceHub: {
            mcps: {
              getAll: () => [],
              isConnected: () => false,
              getToolsFromServer: () => [],
            },
          },
          cancelSession: () => undefined,
        },
        composition: {
          host: {},
          agentCore: {},
          sessionSystem: {},
          contextSystem: {},
        },
        traceRuntime: {},
        schedule: { assistantRuntime: null, history },
        sessionTreeRuntime: {},
        listBindings: () => [],
      } as never,
      bootstrapText: '',
    });

    expect(Object.keys(resources.use(agentHostToken).console).sort()).toEqual(
      ['assistant', 'cancelSession', 'listBindings', 'scheduleExecutions', 'sessionTree', 'trace'],
    );
    expect(resources.use(agentHostToken).console.scheduleExecutions).toBe(history);
    expect(resources.has(workroomHostToken)).toBe(false);
    for (const removed of [
      'bindWorkroomProfiles', 'bindWorkroomKnowledge', 'bindPortfolioSponsor',
      'bindEffectSponsor', 'bindDataLifecycle', 'resolveDataLifecycle',
    ]) {
      expect(coordinator).not.toHaveProperty(removed);
    }
  });
});
