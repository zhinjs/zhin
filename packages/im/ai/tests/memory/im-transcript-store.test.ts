import { describe, it, expect } from 'vitest';
import { MemoryImTranscriptStore } from '../../src/memory/im-transcript-store.js';

describe('ImTranscriptStore (memory)', () => {
  it('skips empty body and media', async () => {
    const store = new MemoryImTranscriptStore();
    await store.record({
      platform: 'icqq',
      endpoint_id: 'b',
      scene_id: 'g',
      scene_type: 'group',
      sender_id: 'u',
      direction: 'inbound',
      body: '   ',
      media_json: '',
    });
    expect(store.getAll()).toHaveLength(0);
  });

  it('records body-only and media-only rows', async () => {
    const store = new MemoryImTranscriptStore();
    await store.record({
      platform: 'icqq',
      endpoint_id: 'b',
      scene_id: 'g',
      scene_type: 'group',
      sender_id: 'u',
      direction: 'inbound',
      body: 'hello',
    });
    await store.record({
      platform: 'icqq',
      endpoint_id: 'b',
      scene_id: 'g',
      scene_type: 'group',
      sender_id: 'u',
      direction: 'inbound',
      body: '',
      media_json: '[{"type":"image","url":"x"}]',
    });
    expect(store.getAll()).toHaveLength(2);
  });
});
