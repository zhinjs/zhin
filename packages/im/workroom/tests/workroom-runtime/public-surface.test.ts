import { describe, expect, it } from 'vitest';
import * as workroom from '../../src/index.js';

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
});
