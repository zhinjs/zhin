import { normalizeKookMessage } from '../src/ws.js';

it('admits channel and private events when SDK enrichment getters throw for absent caches', () => {
  const raw = {
    message_id: 'fixture-message', message_type: 'channel', channel_id: 'fixture-channel',
    author_id: '1910067219', raw_message: '/acceptance probe:kook0002',
    get author() { throw new Error('uncached user'); },
    get channel() { throw new Error('uncached channel'); },
  };
  expect(normalizeKookMessage(raw)).toMatchObject({
    id: 'fixture-message', channelKind: 'channel', channelId: 'fixture-channel',
    authorId: '1910067219', authorName: '1910067219', content: '/acceptance probe:kook0002',
  });
  expect(normalizeKookMessage(Object.create(raw, { message_type: { value: 'private' } }))).toMatchObject({
    channelKind: 'private', channelId: '1910067219',
  });
});
