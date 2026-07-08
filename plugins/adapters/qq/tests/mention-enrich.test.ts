import { describe, it, expect } from 'vitest';
import { enrichCanonicalMentionNames } from '../src/mention-enrich.js';
import type { QQAdapter } from '../src/adapter.js';

describe('enrichCanonicalMentionNames', () => {
  it('fills mention name from endpoint nickname', () => {
    const adapter = {
      endpoints: new Map([
        ['bot-a', {
          $id: 'bot-a',
          $platformUserId: '1689919782',
          $config: { name: 'bot-a', nickname: '小智' },
        }],
      ]),
    } as unknown as QQAdapter;

    const out = enrichCanonicalMentionNames(
      [{ type: 'mention', data: { target: '1689919782' } }],
      adapter,
    );

    expect(out[0]).toEqual({
      type: 'mention',
      data: { target: '1689919782', name: '小智' },
    });
  });

  it('prefers wire mention username over endpoint nickname', () => {
    const adapter = { endpoints: new Map() } as unknown as QQAdapter;
    const out = enrichCanonicalMentionNames(
      [{ type: 'mention', data: { target: '1689919782' } }],
      adapter,
      [{ id: '1689919782', username: '平台昵称' }],
    );
    expect(out[0]?.data).toEqual({ target: '1689919782', name: '平台昵称' });
  });
});
