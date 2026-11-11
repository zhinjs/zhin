import { describe, it, expect } from 'vitest';
import {
  namespaceAuthoringName,
  slotNameFromFile,
  bridgeAuthoringHook,
  defineHook,
} from '../src/authoring/index.js';
import type { AIHook, AIHookEvent } from '../src/resource-hub/types.js';

it('bridges authored hooks through the actual orchestrator hook contract without changing the handler', async () => {
  const seen: AIHookEvent[] = [];
  const definition = defineHook({ event: 'turn.end', handler: event => { seen.push(event); } });
  const hook: AIHook = bridgeAuthoringHook({ runtimeName: 'fixture_audit', definition });
  const event: AIHookEvent = { type: 'turn', action: 'end', context: {}, timestamp: new Date(0), messages: [] };
  expect(hook).toEqual({ name: 'fixture_audit', event: 'turn.end', handler: definition.handler });
  await hook.handler(event);
  expect(seen).toEqual([event]);
});

describe('namespaceAuthoringName', () => {
  it('prefixes plugin slot names', () => {
    expect(namespaceAuthoringName('lottery', 'sync')).toBe('lottery_sync');
  });

  it('allows bare workspace names', () => {
    expect(namespaceAuthoringName('workspace', 'researcher', true)).toBe('researcher');
  });
});

describe('slotNameFromFile', () => {
  it('strips extension', () => {
    expect(slotNameFromFile('/p/evals/quality.eval.ts')).toBe('quality.eval');
  });
});
