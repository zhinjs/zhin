import { describe, expect, it } from 'vitest';
import * as protocol from '../../packages/console/protocol/src/feature.js';
import * as runtime from '../../packages/im/plugin-runtime/src/layered-config.js';

/**
 * ADR 0055 §1 conversation keys `<alias>/<endpointId>/<kind>:<escaped id>` (#1250 b80).
 * `@zhin.js/plugin-runtime` (runtime resolution) and `@zhin.js/console-protocol` (Console wire,
 * browsers) are both zero-dependency contracts, so neither can import the other: each keeps its own
 * copy and this contract locks the two to the same grammar, the same escaping and the same verdicts.
 */
const refs = [
  { adapter: 'qq', endpointId: 'bot-1', kind: 'private', id: 'u/1:x' },
  { adapter: 'qq', endpointId: 'bot', kind: 'channel', id: 'a/b%:c' },
  { adapter: 'icqq', endpointId: '10001', kind: 'group', id: '123' },
  { adapter: 'sandbox', endpointId: 'sandbox-bot', kind: 'group', id: '%25%2F' },
  { adapter: 'a1-b', endpointId: 'x'.repeat(128), kind: 'group', id: 'y'.repeat(256) },
] as const;

const invalidRefs = [
  { adapter: 'QQ', endpointId: 'bot', kind: 'group', id: '1' },
  { adapter: '-qq', endpointId: 'bot', kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: 'b/c', kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: 'b~c', kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: 'b\0c', kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: '', kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: 'x'.repeat(129), kind: 'group', id: '1' },
  { adapter: 'qq', endpointId: 'bot', kind: 'guild', id: '1' },
  { adapter: 'qq', endpointId: 'bot', kind: 'group', id: '' },
  { adapter: 'qq', endpointId: 'bot', kind: 'group', id: 'x'.repeat(257) },
  { adapter: 'qq', endpointId: 'bot', kind: 'group', id: 'a\nb' },
  { adapter: 'qq', endpointId: 'bot', kind: 'group', id: 'a\u007fb' },
] as const;

const keys = [
  'qq/bot/group:1', 'qq/bot/private:u%2F1:x', 'qq/bot/channel:a%2fb', 'qq/bot/group:a%20b', 'qq/bot/group:a/b',
  'qq/bot/group:', 'qq/bot/:1', 'qq/bot/guild:1', 'qq/bot', 'qq', '', '/bot/group:1', 'qq//group:1', 'QQ/bot/group:1',
  'qq/bot/group:%25', 'qq/bot/group:%2F', 'qq/b~t/group:1', `qq/bot/group:${'z'.repeat(257)}`,
];

const formatRuntime = (ref: (typeof refs)[number] | (typeof invalidRefs)[number]) =>
  runtime.formatFeatureConversationKey(ref.adapter, ref.endpointId, { kind: ref.kind as runtime.FeatureConversationKind, id: ref.id });
const formatProtocol = (ref: (typeof refs)[number] | (typeof invalidRefs)[number]) =>
  protocol.formatFeatureConversationKey({ ...ref, kind: ref.kind as protocol.ConsoleFeatureConversationKind });

describe('feature conversation key: plugin-runtime ≡ console-protocol', () => {
  it('shares the id length limit and the kinds', () => {
    expect(runtime.FEATURE_CONVERSATION_ID_MAX_LENGTH).toBe(protocol.FEATURE_CONVERSATION_ID_MAX_LENGTH);
    expect([...runtime.FEATURE_CONVERSATION_KINDS]).toEqual([...protocol.CONSOLE_FEATURE_CONVERSATION_KINDS]);
  });

  it('formats valid references identically and both round-trip', () => {
    for (const ref of refs) {
      const key = formatProtocol(ref);
      expect(formatRuntime(ref)).toBe(key);
      expect(protocol.parseFeatureConversationKey(key)).toEqual(ref);
      expect(runtime.parseFeatureConversationKey(key)).toEqual({ adapter: ref.adapter, endpointId: ref.endpointId, conversation: { kind: ref.kind, id: ref.id } });
    }
  });

  it('refuses the same invalid references with the same message', () => {
    for (const ref of invalidRefs) {
      let runtimeError: unknown;
      let protocolError: unknown;
      try { formatRuntime(ref); } catch (error) { runtimeError = error; }
      try { formatProtocol(ref); } catch (error) { protocolError = error; }
      expect(runtimeError, JSON.stringify(ref)).toBeInstanceOf(TypeError);
      expect(protocolError, JSON.stringify(ref)).toBeInstanceOf(TypeError);
      expect((protocolError as Error).message).toBe((runtimeError as Error).message);
    }
  });

  it('parses, escapes and validates every key and id the same way', () => {
    for (const key of keys) {
      const fromProtocol = protocol.parseFeatureConversationKey(key);
      const fromRuntime = runtime.parseFeatureConversationKey(key);
      expect(fromRuntime === undefined, key).toBe(fromProtocol === undefined);
      if (fromProtocol && fromRuntime) {
        expect({ adapter: fromRuntime.adapter, endpointId: fromRuntime.endpointId, ...fromRuntime.conversation }).toEqual(fromProtocol);
      }
    }
    for (const id of ['a/b%c', '%2F', '%25', 'a%20b', 'a/b', 'a%2fb', '', 'x'.repeat(256), 'x'.repeat(257), 'a\tb']) {
      expect(runtime.escapeFeatureConversationId(id)).toBe(protocol.escapeFeatureConversationId(id));
      expect(runtime.unescapeFeatureConversationId(id)).toBe(protocol.unescapeFeatureConversationId(id));
      expect(runtime.isFeatureConversationId(id)).toBe(protocol.isFeatureConversationId(id));
    }
  });
});
