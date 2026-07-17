import { describe, expect, it } from 'vitest';
import {
  GenerationHandoffStack,
  RootController,
  rootPluginId,
  type GenerationHandoff,
  type SnapshotState,
} from '../src/index.js';

describe('Generation handoff', () => {
  it('composes parent-first activation and reverse-order rollback', async () => {
    const events: string[] = [];
    const stack = new GenerationHandoffStack();
    stack.add(participant('parent', events));
    stack.add(participant('child', events));
    const handoff = stack.seal()!;
    const root = new RootController(emptyState());

    await handoff.quiescePrevious(root.snapshots.current);
    await handoff.activateNext();
    handoff.openNext();
    await handoff.deactivateNext();
    await handoff.resumePrevious();

    expect(events).toEqual([
      'child:quiesce:0',
      'parent:quiesce:0',
      'parent:activate',
      'child:activate',
      'parent:open',
      'child:open',
      'child:deactivate',
      'parent:deactivate',
      'parent:resume',
      'child:resume',
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

    await expect(handoff.activateNext()).rejects.toThrow('child failed');

    expect(events).toEqual([
      'parent:activate',
      'child:activate',
      'parent:deactivate',
    ]);
  });

  it('resumes only participants quiesced before a partial failure', async () => {
    const events: string[] = [];
    const stack = new GenerationHandoffStack();
    stack.add({
      quiescePrevious() {
        events.push('parent:quiesce');
        throw new Error('parent failed');
      },
      resumePrevious() { events.push('parent:resume'); },
    });
    stack.add(participant('child', events));
    const handoff = stack.seal()!;
    const root = new RootController(emptyState());

    await expect(handoff.quiescePrevious(root.snapshots.current)).rejects.toThrow('parent failed');

    expect(events).toEqual([
      'child:quiesce:0',
      'parent:quiesce',
      'child:resume',
    ]);
  });

  it('commits only after quiesce and activation, then opens the new generation', async () => {
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
      'next:quiesce:1',
      'next:activate',
      'next:open',
      'old:dispose',
    ]);
    await root.stop();
  });

  it('deactivates the shadow generation and resumes the previous one on failure', async () => {
    const events: string[] = [];
    const root = new RootController(emptyState());
    await root.start(() => prepared('old', events));

    await expect(root.transact(() => ({
      ...prepared('next', events),
      handoff: {
        quiescePrevious(previous) { events.push(`next:quiesce:${previous.generation}`); },
        activateNext() {
          events.push('next:activate');
          throw new Error('bind failed');
        },
        deactivateNext() { events.push('next:deactivate'); },
        resumePrevious() { events.push('next:resume'); },
        openNext() { events.push('next:open'); },
      },
    }))).rejects.toThrow('bind failed');

    expect(root.generation).toBe(1);
    expect(events).toEqual([
      'next:quiesce:1',
      'next:activate',
      'next:deactivate',
      'next:resume',
      'next:dispose',
    ]);
    await root.stop();
  });

  it('reports open failures without rolling back a committed generation', async () => {
    const reported: unknown[] = [];
    const root = new RootController(emptyState(), (error) => { reported.push(error); });
    await root.start(() => prepared('old', []));

    const snapshot = await root.transact(() => ({
      ...prepared('next', []),
      handoff: {
        quiescePrevious() {},
        activateNext() {},
        deactivateNext() {},
        resumePrevious() {},
        openNext() { throw new Error('admission failed'); },
      },
    }));

    expect(snapshot.generation).toBe(2);
    expect(root.generation).toBe(2);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual(expect.objectContaining({ message: 'admission failed' }));
    await root.stop();
  });
});

function participant(name: string, events: string[]): GenerationHandoff {
  return {
    quiescePrevious(previous) { events.push(`${name}:quiesce:${previous.generation}`); },
    activateNext() { events.push(`${name}:activate`); },
    deactivateNext() { events.push(`${name}:deactivate`); },
    resumePrevious() { events.push(`${name}:resume`); },
    openNext() { events.push(`${name}:open`); },
  };
}

function recordingHandoff(events: string[], expected: number): GenerationHandoff {
  return {
    quiescePrevious(previous) {
      expect(previous.generation).toBe(expected);
      events.push(`next:quiesce:${previous.generation}`);
    },
    activateNext() { events.push('next:activate'); },
    deactivateNext() { events.push('next:deactivate'); },
    resumePrevious() { events.push('next:resume'); },
    openNext() { events.push('next:open'); },
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
