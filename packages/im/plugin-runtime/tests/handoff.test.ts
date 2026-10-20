import { describe, expect, it } from 'vitest';
import {
  GenerationHandoffStack,
  RootController,
  rootPluginId,
  type GenerationHandoff,
  type SnapshotState,
} from '../src/index.js';

describe('Generation handoff', () => {
  it('composes parent-first readiness and reverse-order rollback', async () => {
    const events: string[] = [];
    const stack = new GenerationHandoffStack();
    stack.add(participant('parent', events));
    stack.add(participant('child', events));
    const handoff = stack.seal()!;
    await handoff.activateNext(new AbortController().signal);
    await handoff.deactivateNext();

    expect(events).toEqual([
      'parent:activate',
      'child:activate',
      'child:deactivate',
      'parent:deactivate',
    ]);
  });

  it('deactivates only participants activated before a partial failure', async () => {
    const events: string[] = [];
    const stack = new GenerationHandoffStack();
    stack.add(participant('parent', events));
    stack.add({
      activateNext() {
        events.push('child:activate');
        throw new Error('child failed');
      },
      deactivateNext() { events.push('child:deactivate'); },
    });
    stack.add(participant('unreached', events));
    const handoff = stack.seal()!;

    await expect(handoff.activateNext(new AbortController().signal)).rejects.toThrow('child failed');

    expect(events).toEqual([
      'parent:activate',
      'child:activate',
      'parent:deactivate',
    ]);
  });

  it('publishes only after every fallible readiness step succeeds', async () => {
    const events: string[] = [];
    const root = new RootController(emptyState());
    await root.start(() => prepared('old', events));

    await root.transact((previous) => ({
      ...prepared('next', events),
      handoff: recordingHandoff(events, previous.generation),
    }));
    await Promise.resolve();

    expect(root.generation).toBe(2);
    expect(events).toEqual([
      'next:activate',
      'old:dispose',
    ]);
    await root.stop();
  });

  it('deactivates the shadow generation without touching the previous one on failure', async () => {
    const events: string[] = [];
    const root = new RootController(emptyState());
    await root.start(() => prepared('old', events));

    await expect(root.transact(() => ({
      ...prepared('next', events),
      handoff: {
        activateNext() {
          events.push('next:activate');
          throw new Error('bind failed');
        },
        deactivateNext() { events.push('next:deactivate'); },
      },
    }))).rejects.toThrow('bind failed');

    expect(root.generation).toBe(1);
    expect(events).toEqual([
      'next:activate',
      'next:deactivate',
      'next:dispose',
    ]);
    await root.stop();
  });
});

function participant(name: string, events: string[]): GenerationHandoff {
  return {
    activateNext() { events.push(`${name}:activate`); },
    deactivateNext() { events.push(`${name}:deactivate`); },
  };
}

function recordingHandoff(events: string[], expected: number): GenerationHandoff {
  return {
    activateNext() {
      expect(expected).toBe(1);
      events.push('next:activate');
    },
    deactivateNext() { events.push('next:deactivate'); },
  };
}

function prepared(name: string, events: string[]) {
  return {
    snapshot: emptyState(),
    dispose: () => { events.push(`${name}:dispose`); },
  };
}

function emptyState(): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}
