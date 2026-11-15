import { describe, expect, it } from 'vitest';
import { purposeKeyEffects, subAgentPurposeEffect } from '../../src/model-runtime/purpose-effect.js';
import { inferencePurposeEffects } from '../../src/plugin-runtime/inference/management.js';

const bindings = new Set(['zhin', 'planner']);

describe('subAgentPurposeEffect (#1250 agent-purpose-binding-ignored, #1270)', () => {
  it('prefers the qualified name, accepts a unique bare name, and reports why a key is ignored', () => {
    const keys = new Set(['tools__researcher', 'reviewer', 'planner', 'evaluator']);
    expect(subAgentPurposeEffect(keys, { name: 'researcher', qualifiedName: 'tools__researcher' }, bindings))
      .toEqual({ status: 'effective', key: 'tools__researcher' });
    expect(subAgentPurposeEffect(keys, { name: 'reviewer', qualifiedName: 'tools__reviewer' }, bindings))
      .toEqual({ status: 'effective', key: 'reviewer' });
    expect(subAgentPurposeEffect(keys, { name: 'planner', qualifiedName: 'tools__planner' }, bindings))
      .toEqual({ status: 'ignored', key: 'planner', reason: 'binding-name' });
    expect(subAgentPurposeEffect(keys, { name: 'evaluator', qualifiedName: 'a__evaluator', bareNameShared: true }, bindings))
      .toEqual({ status: 'ignored', key: 'evaluator', reason: 'ambiguous' });
    expect(subAgentPurposeEffect(keys, { name: 'executor' }, bindings)).toEqual({ status: 'unconfigured' });
  });
});

describe('purposeKeyEffects', () => {
  it('classifies every configured key, deriving shared bare names from the list', () => {
    const effects = purposeKeyEffects(['planner', 'evaluator', 'tools__researcher', 'typo', 'zhin'], [
      { name: 'planner', qualifiedName: 'tools__planner' },
      { name: 'evaluator', qualifiedName: 'a__evaluator' },
      { name: 'evaluator', qualifiedName: 'b__evaluator' },
      { name: 'researcher', qualifiedName: 'tools__researcher' },
    ], bindings);
    expect(effects).toEqual({
      evaluator: { status: 'ignored', reason: 'ambiguous', agents: ['a__evaluator', 'b__evaluator'] },
      planner: { status: 'effective', target: 'binding', ignoredAgents: ['tools__planner'], reason: 'binding-name' },
      tools__researcher: { status: 'effective', target: 'sub-agent', agents: ['tools__researcher'] },
      typo: { status: 'ignored', reason: 'no-target' },
    });
  });

  it('keys the management view as agents.<key>', () => {
    expect(inferencePurposeEffects({ reviewer: 'profiles:x', empty: '' }, {
      bindingNames: ['zhin'], subAgents: [{ name: 'reviewer', qualifiedName: 'tools__reviewer', kind: 'bare' }],
    })).toEqual({ 'agents.reviewer': { status: 'effective', target: 'sub-agent', agents: ['tools__reviewer'] } });
  });
});
