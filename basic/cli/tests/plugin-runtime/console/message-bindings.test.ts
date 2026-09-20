import { describe, expect, it } from 'vitest';
import type { RuntimeMessageEvent } from '@zhin.js/core/runtime';
import { createConsoleEventHub } from '@zhin.js/host-http';
import {
  ConsoleMessageBindings,
  type ConsoleMessageRuntimePort,
} from '../../../src/plugin-runtime/console/message-bindings.js';

function createMessageSource(): {
  readonly im: ConsoleMessageRuntimePort;
  readonly emit: (event: RuntimeMessageEvent) => void;
  readonly listenerCount: () => number;
} {
  const listeners = new Set<(event: RuntimeMessageEvent) => void>();
  return {
    im: {
      messageEvents: {
        subscribe(listener: (event: RuntimeMessageEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      endpoints: { get: () => null },
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

const message: RuntimeMessageEvent = {
  direction: 'inbound',
  conversation: {
    endpoint: { id: 'root\0zhin.adapter\0sandbox', adapter: 'root' },
    kind: 'private',
    id: 'alice',
  },
  sender: { id: 'alice' },
  contentPreview: 'hello',
  timestamp: 1_700_000_000_000,
};

describe('ConsoleMessageBindings', () => {
  it('shares one subscription across overlapping generations and releases it at the last owner', () => {
    const hub = createConsoleEventHub({ runtimeId: 'message-bindings-test' });
    const source = createMessageSource();
    const bindings = new ConsoleMessageBindings({ hub });

    const releaseFirst = bindings.acquire(source.im);
    const releaseSecond = bindings.acquire(source.im);
    expect(source.listenerCount()).toBe(1);

    releaseFirst();
    expect(source.listenerCount()).toBe(1);
    source.emit(message);
    expect(hub.history({ after: 0 }).items).toHaveLength(1);

    releaseSecond();
    expect(source.listenerCount()).toBe(0);
    source.emit(message);
    expect(hub.history({ after: 0 }).items).toHaveLength(1);
  });
});
