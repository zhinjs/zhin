import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAgentState,
  updateAgentState,
  registerAuthoringStateFromDefinition,
  resetAgentStateStoreForTests,
} from '../../src/state/agent-state-store.js';

describe('agent-state-store', () => {
  beforeEach(() => {
    resetAgentStateStoreForTests();
  });

  it('lazy-inits and updates session state', () => {
    registerAuthoringStateFromDefinition('budget', 'test', () => ({ spent: 0 }));
    expect(getAgentState<{ spent: number }>('s1', 'budget')).toEqual({ spent: 0 });
    updateAgentState('s1', 'budget', (prev) => ({ spent: (prev?.spent ?? 0) + 1 }));
    expect(getAgentState<{ spent: number }>('s1', 'budget')).toEqual({ spent: 1 });
  });
});
