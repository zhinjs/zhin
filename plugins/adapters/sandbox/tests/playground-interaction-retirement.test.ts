import { expect, it } from 'vitest';
import type { MessageSegment } from '@zhin.js/client';
import { retirePlaygroundInteractions, type PlaygroundMessage } from '../pages/index/playgroundState.js';

const keyboard = (payload: string): MessageSegment[] => [{ type: 'keyboard', data: { rows: [[{ label: 'Confirm', payload }]] } }];
const row = (id: string, content = keyboard('random-current-token')): PlaygroundMessage => ({
  id, type: 'received', channelType: 'group', channelId: 'room', channelName: 'Project', senderId: 'endpoint', senderName: 'Bot',
  content, timestamp: 1, interactionReadOnly: false,
});

it('retires only a received prompt with the exact server-issued retired payload in the current scene', () => {
  const matching = { ...row('prompt'), interactionResolved: true }, unrelated = row('plugin', keyboard('plugin-live-token'));
  const input = { ...row('user'), type: 'sent' as const };
  const otherScene = { ...row('other-scene'), channelId: 'other' }, otherKind = { ...row('other-kind'), channelType: 'private' as const };
  const freshSameId = row('prompt', keyboard('new-random-token'));
  const result = retirePlaygroundInteractions([matching, unrelated, input, otherScene, otherKind, freshSameId], { id: 'room', type: 'group' }, keyboard('random-current-token'));
  expect(result[0]).toEqual({ ...matching, interactionReadOnly: true });
  expect(result.slice(1)).toEqual([unrelated, input, otherScene, otherKind, freshSameId]);
  expect(result.slice(1).every((value, index) => value === [unrelated, input, otherScene, otherKind, freshSameId][index])).toBe(true);
  expect(matching.interactionReadOnly).toBe(false);
});

it.each(['entries', 'messages'])('matches nested forward %s without treating arbitrary text or sibling controls as retired', field => {
  const nested = { type: 'forward', data: field === 'entries'
    ? { entries: [{ segments: keyboard('nested-random-token') }] }
    : { messages: [keyboard('nested-random-token')] } } as MessageSegment;
  const nestedRow = row('nested', [nested]);
  const [retired, active] = retirePlaygroundInteractions([nestedRow, row('sibling', keyboard('other-token'))],
    { id: 'room', type: 'group' }, [nested]);
  expect(retired).toEqual({ ...nestedRow, interactionReadOnly: true });
  expect(retired).not.toHaveProperty('interactionResolved');
  expect(active.interactionReadOnly).toBe(false);
});

it('an empty first projection or plain text containing a token cannot disable any live control', () => {
  const current = [row('newly-delivered')];
  expect(retirePlaygroundInteractions(current, { id: 'room', type: 'group' }, [])).toEqual(current);
  expect(retirePlaygroundInteractions(current, { id: 'room', type: 'group' }, [{ type: 'text', data: { text: 'random-current-token' } }])).toEqual(current);
});
