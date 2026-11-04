import { RepeaterEngine, DEFAULT_REPEATER_CONFIG } from '../src/engine.js';

it('keeps repeat counts and cooldowns in the complete canonical conversation', () => {
  const engine = new RepeaterEngine();
  const config = { ...DEFAULT_REPEATER_CONFIG, threshold: 2 };
  const message = (account: string, threadId: string, sender: string) => ({
    conversation: { endpoint: { adapter: 'synthetic', id: account }, kind: 'channel' as const,
      id: 'shared-native-id', threadId }, sender: { id: sender }, content: 'same text',
  });
  try {
    expect(engine.tick(message('account-a', 'thread-a', 'alice'), config).action).toBe('next');
    expect(engine.tick(message('account-b', 'thread-a', 'bob'), config).action).toBe('next');
    expect(engine.tick(message('account-a', 'thread-b', 'bob'), config).action).toBe('next');
    expect(engine.tick(message('account-a', 'thread-a', 'bob'), config).action).toBe('repeat');
    expect(engine.tick(message('account-b', 'thread-a', 'alice'), config).action).toBe('repeat');
    expect(engine.tick(message('account-a', 'thread-b', 'alice'), config).action).toBe('repeat');
  } finally { engine.dispose(); }
});
