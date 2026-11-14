import { describe, expect, it } from 'vitest';
import { parseSandboxWsFrame, parseSandboxWsPayload, resolveSandboxEndpoint } from '../src/protocol.js';

const self = { id: 'sandbox-bot', names: ['小助手'] };

describe('Sandbox typed [@name] mentions (#1250)', () => {
  it('turns [@<bot id>] into a mention of the bot and strips it from the command text', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({ type: 'group', id: 'g', content: '[@sandbox-bot] /help' }), self);
    expect(parsed.content).toEqual([
      { type: 'mention', data: { target: 'sandbox-bot', name: 'sandbox-bot' } },
      { type: 'text', data: { text: ' /help' } },
    ]);
    expect(parsed.text).toBe('/help');
  });

  it('matches the configured nickname and the id case-insensitively', () => {
    const byName = parseSandboxWsPayload(JSON.stringify({ type: 'group', id: 'g', content: '问一下 [@小助手] 天气' }), self);
    expect(byName.content[1]).toEqual({ type: 'mention', data: { target: 'sandbox-bot', name: '小助手' } });
    expect(byName.text).toBe('问一下 天气');
    const upper = parseSandboxWsPayload(JSON.stringify({ type: 'group', id: 'g', content: '[@Sandbox-Bot]hi' }), self);
    expect(upper.content[0]).toMatchObject({ type: 'mention', data: { target: 'sandbox-bot' } });
  });

  it('keeps other people as mention segments and @name in the text', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({ type: 'group', id: 'g', content: 'hi [@alice] and [@sandbox-bot]' }), self);
    expect(parsed.content.filter(segment => segment.type === 'mention').map(segment => segment.data.target)).toEqual(['alice', 'sandbox-bot']);
    expect(parsed.text).toBe('hi @alice and');
  });

  it('rewrites a picked mention segment carrying the bot name to the bot id', () => {
    const frame = parseSandboxWsFrame(JSON.stringify({ type: 'group', id: 'g', content: [
      { type: 'mention', data: { target: '小助手', name: '小助手' } }, { type: 'text', data: { text: ' ping' } },
    ] }), self);
    expect(frame.kind).toBe('message');
    if (frame.kind !== 'message') return;
    expect(frame.message.content[0]).toEqual({ type: 'mention', data: { target: 'sandbox-bot', name: '小助手' } });
    expect(frame.message.text).toBe(' ping');
  });

  it('leaves text without typed mentions untouched (including without a self identity)', () => {
    expect(parseSandboxWsPayload(JSON.stringify({ content: 'a [b] c' }), self)).toMatchObject({ text: 'a [b] c', content: [{ type: 'text', data: { text: 'a [b] c' } }] });
    expect(parseSandboxWsPayload(JSON.stringify({ content: '[@x] y' }))).toMatchObject({ text: '@x y' });
  });

  it('carries the configured nickname into the resolved endpoint', () => {
    expect(resolveSandboxEndpoint({ id: 'bot', nickname: ' 小助手 ' }).nickname).toBe('小助手');
    expect(resolveSandboxEndpoint({ id: 'bot' })).not.toHaveProperty('nickname');
  });
});
