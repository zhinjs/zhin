import { expect, it } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import adapter from '../adapters/dingtalk/index.js';

it('declares the ADR 0056 §1 platform standing for group conversations only', () => {
  const conversation = (kind: 'group' | 'private') => ({ endpoint: { id: 'e', adapter: 'dingtalk' }, kind, id: '1' });
  expect(resolveTurnCapabilities({ profile: adapter.profile!, conversation: conversation('group') }).get('scene.platformStanding')).toEqual({ standing: true });
  expect(resolveTurnCapabilities({ profile: adapter.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
});
