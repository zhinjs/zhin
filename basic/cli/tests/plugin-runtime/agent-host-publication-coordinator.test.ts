import { agentHostToken } from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { AgentHostPublicationCoordinator } from '../../src/plugin-runtime/agent-host-publication-coordinator.js';

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
      workroom: {} as never,
      bootstrapText: '',
    })).toThrow('generation replaced');
    expect(resources.has(agentHostToken)).toBe(false);
  });

  it('projects late-bound controls through the already-published Host port', () => {
    const resources = new Scope(rootPluginId());
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
        schedule: { assistantRuntime: null },
        sessionTreeRuntime: {},
        listBindings: () => [],
      } as never,
      workroom: {
        runtime: {},
        kernel: { controlRun: () => undefined },
        catalog: {},
      } as never,
      bootstrapText: '',
    });
    const control = {} as never;

    expect(resources.use(agentHostToken).console.workroomProfiles).toBeUndefined();
    coordinator.bindWorkroomProfiles(control);
    expect(resources.use(agentHostToken).console.workroomProfiles).toBe(control);
    expect(() => coordinator.bindWorkroomProfiles(control)).toThrow(
      'Workroom Profile control is already bound',
    );
  });
});
