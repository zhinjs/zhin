import { describe, expect, it } from 'vitest';
import { Message } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { AITriggerConfig } from '@zhin.js/core';
import { hasIgnoredTriggerPrefix, isMergeableGroupTurn, matchAiTrigger } from '../../src/plugin-runtime/index.js';

// #1250 第 82 批: one "is this a command" judgement — the adapter's real commandPrefix plus ignorePrefixes.
const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

function makeMessage(content: string, commandPrefix: string | undefined, kind: 'group' | 'private' = 'group'): Message {
  const conversation = { endpoint: { id: String(adapter), adapter: 'icqq' }, kind, id: kind === 'group' ? '100' : 'u1' };
  return new Message(
    { conversation, content, sender: 'user-1', metadata: Object.freeze({}), message: { conversation, id: 'm1' } },
    {
      generation: 1,
      reply: async () => ({ status: 'sent' as const }),
      ...(commandPrefix !== undefined ? { presentation: { commands: { prefix: commandPrefix } } } : {}),
    },
  );
}

const mergeable = (content: string, commandPrefix: string | undefined, trigger?: AITriggerConfig, addressed = content) =>
  isMergeableGroupTurn({ message: makeMessage(content, commandPrefix), trigger, plainText: true, isMaster: false, content: addressed });

describe('command-like prefixes (#1250 第 82 批)', () => {
  it("never turns an empty commandPrefix into 'every message is a command'", () => {
    expect(hasIgnoredTriggerPrefix('今晚几点开会', undefined, '')).toBe(false);
    expect(mergeable('今晚几点开会', '')).toBe(true);
    expect(matchAiTrigger(makeMessage('你好', '', 'private'), undefined)).toEqual({ content: '你好' });
  });

  it('keeps the default ignorePrefixes whatever the commandPrefix', () => {
    for (const prefix of ['', '#', '!!', undefined]) {
      expect(hasIgnoredTriggerPrefix('/status', undefined, prefix)).toBe(true);
      expect(mergeable('/status', prefix)).toBe(false);
      expect(matchAiTrigger(makeMessage('/status', prefix, 'private'), undefined)).toBeNull();
    }
  });

  it("treats the adapter's real commandPrefix as a command prefix", () => {
    expect(hasIgnoredTriggerPrefix('#签到', undefined, '#')).toBe(true);
    expect(matchAiTrigger(makeMessage('#签到', '#', 'private'), undefined)).toBeNull();
    expect(mergeable('#签到', '#')).toBe(false);
    const custom: AITriggerConfig = { ignorePrefixes: ['~'] };
    expect(hasIgnoredTriggerPrefix('!!roll', custom, '!!')).toBe(true);
    expect(matchAiTrigger(makeMessage('!!roll', '!!', 'private'), custom)).toBeNull();
    expect(mergeable('!!roll', '!!', custom)).toBe(false);
    // A configured ignore list replaces the defaults but never drops the real commandPrefix.
    expect(hasIgnoredTriggerPrefix('/status', custom, '!!')).toBe(false);
    expect(hasIgnoredTriggerPrefix('~x', custom, '!!')).toBe(true);
    // Another adapter's prefix is plain text here.
    expect(mergeable('!!roll', '#', custom)).toBe(true);
  });

  it('judges the addressed content the same way (no hard-coded / or #)', () => {
    // `@bot /status`: the raw text is a mention, the addressed content is a command.
    expect(mergeable('@bot /status', '', undefined, '/status')).toBe(false);
    expect(mergeable('@bot !!roll', '!!', undefined, '!!roll')).toBe(false);
    // `#` is no command unless it is the adapter's prefix (the raw `#` trigger prefix still keeps it out).
    expect(mergeable('@bot #话题 今晚吃什么', '', undefined, '#话题 今晚吃什么')).toBe(true);
    expect(mergeable('@bot #签到', '#', undefined, '#签到')).toBe(false);
    expect(mergeable('#帮助', '', undefined, '帮助')).toBe(false);
  });

  it('keeps `/` out of the merge window even when ignorePrefixes leave it out', () => {
    const custom: AITriggerConfig = { ignorePrefixes: ['~'] };
    // `/` is no command-like prefix for AI triggering here ...
    expect(hasIgnoredTriggerPrefix('/status', custom, '#')).toBe(false);
    // ... but a slash command never merges with its neighbours, raw or addressed.
    expect(mergeable('/status', '#', custom)).toBe(false);
    expect(mergeable('@bot /status', '#', custom, '/status')).toBe(false);
    expect(mergeable('@bot /status', '', custom, '/status')).toBe(false);
    // Plain chat with this configuration still merges.
    expect(mergeable('@bot 今晚吃什么', '#', custom, '今晚吃什么')).toBe(true);
  });
});
