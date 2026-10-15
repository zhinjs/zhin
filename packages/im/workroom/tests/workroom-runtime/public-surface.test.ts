import { describe, expect, it } from 'vitest';
import * as workroom from '../../src/index.js';
import * as workroomRemote from '../../src/remote.js';

describe('@zhin.js/workroom public surface', () => {
  it('exports the Workroom runtime names formerly exposed by @zhin.js/agent', () => {
    for (const name of [
      'createWorkroomRuntime',
      'resolveWorkroomBotIdentity',
      'defineWorkroomDatabaseModels',
      'prepareWorkroomDatabaseStorage',
      'workroomHostToken',
      'createAgentCoreWorkroomLocalTurnPort',
      'selfDeliveryProjectToken',
      'SelfDeliveryProject',
      'validateWorkroomDefinitions',
      'createWorkroomDeferredCapabilityPlan',
    ]) {
      expect(workroom, name).toHaveProperty(name);
    }
  });

  it('keeps the frozen remote A2A extension out of the package root', () => {
    for (const name of ['createWorkroomRemoteCallbackRuntime', 'RemoteCallbackApplication']) {
      expect(workroom, name).not.toHaveProperty(name);
      expect(workroomRemote, name).toHaveProperty(name);
    }
  });
});
