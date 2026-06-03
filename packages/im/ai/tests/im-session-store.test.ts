import { describe, it, expect } from 'vitest';
import { MemoryIMSessionStore } from '../src/memory/im-session-store.js';

describe('MemoryIMSessionStore', () => {
  it('archives active session and creates new epoch on next getOrCreate', async () => {
    const store = new MemoryIMSessionStore();
    const input = {
      session_key: 'icqq:b1:group:g1',
      platform: 'icqq',
      bot_id: 'b1',
      scene_id: 'g1',
      scene_type: 'group',
    };
    const first = await store.getOrCreateActive(input);
    await store.archiveByKey(input.session_key);
    const second = await store.getOrCreateActive(input);
    expect(first.session_id).not.toBe(second.session_id);
    expect(second.status).toBe('active');
    const active = await store.findActive(input.session_key);
    expect(active?.session_id).toBe(second.session_id);
  });
});
