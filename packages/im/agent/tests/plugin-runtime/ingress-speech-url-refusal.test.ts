import { describe, expect, it, vi } from 'vitest';
import { adapterFeatureId, resolveTurnCapabilities, type AdapterCapabilityProfile } from '@zhin.js/adapter';
import type { Message } from '@zhin.js/core';
import { admitIngressMailTurn } from '../../src/plugin-runtime/ingress/ingress-outbound.js';
import { preprocessInboundTurn, SPEECH_URL_BLOCKED_NOTE } from '../../src/plugin-runtime/ingress/content.js';
import { inboundVoiceSegmentsFromPlatform } from '../../src/plugin-runtime/ingress/request-capabilities.js';

/** #1250 第 45 批 speech-url-ssrf: a refused voice address does not stop the turn. */
describe('admitIngressMailTurn with a refused voice address', () => {
  it('admits the turn with a note in place of the transcript', async () => {
    const message = {
      sender: { id: 'u-1' },
      content: '帮我听一下 [audio:https://10.0.0.8/secret.ogg]',
      segments: [{ type: 'audio', data: { media: { kind: 'url', value: 'https://10.0.0.8/secret.ogg' } } }],
      metadata: {},
    } as unknown as Message;
    const admit = vi.fn(async (input: { text: string }) => ({ kind: 'run' as const, text: input.text, facts: {} }));
    const transcribeUrl = vi.fn(async () => ({ status: 'refused' as const, code: 'speech_url_blocked' as const }));
    const reply = vi.fn();

    const result = await admitIngressMailTurn({
      message,
      matchedContent: message.content,
      transcribeUrl,
      matchedVenue: undefined,
      venueRoute: undefined,
      mailbox: { admit } as never,
      gate: undefined,
      sessionKey: 'session-1',
      turnId: 'turn-1',
      senderId: 'u-1',
      entryActorName: 'main',
      senderRoles: {} as never,
      plainText: true,
      liveRoom: false,
      mergeable: false,
      turnAccess: {} as never,
      audit: vi.fn(),
      reply,
    });

    // No `platformSegments`: the segment is treated as user-typed (HTTPS only).
    expect(transcribeUrl).toHaveBeenCalledWith('https://10.0.0.8/secret.ogg', { origin: 'user' });
    expect(result.kind).toBe('admitted');
    const text = `帮我听一下\n${SPEECH_URL_BLOCKED_NOTE}`;
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ text }));
    expect(result.kind === 'admitted' && result.inbound).toEqual({ text, sttApplied: false, sttRefusal: 'speech_url_blocked' });
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('voice address origin (#1250 第 45 批: platform voice links may be plain http)', () => {
  const qqVoice = 'http://multimedia.example.qq.com/download?appid=1402&fileid=abc';
  const transcriber = () => vi.fn(async () => '转写');

  it('a voice segment is a platform address only when the Endpoint builds segments from the platform', async () => {
    const message = { content: '', metadata: {}, segments: [{ type: 'record', data: { url: qqVoice } }] } as unknown as Message;
    const asPlatform = transcriber();
    await preprocessInboundTurn(message, '', asPlatform, { platformSegments: true });
    expect(asPlatform).toHaveBeenCalledWith(qqVoice, { origin: 'platform' });

    const asUser = transcriber();
    await preprocessInboundTurn(message, '', asUser);
    expect(asUser).toHaveBeenCalledWith(qqVoice, { origin: 'user' });

    const media = { content: '', metadata: {}, segments: [{ type: 'audio', data: { media: { kind: 'url', value: qqVoice } } }] } as unknown as Message;
    const viaMedia = transcriber();
    await preprocessInboundTurn(media, '', viaMedia, { platformSegments: true });
    expect(viaMedia).toHaveBeenCalledWith(qqVoice, { origin: 'platform' });

    const meta = { content: '', metadata: { audio_url: qqVoice } } as unknown as Message;
    const viaMeta = transcriber();
    await preprocessInboundTurn(meta, '', viaMeta, { platformSegments: true });
    expect(viaMeta).toHaveBeenCalledWith(qqVoice, { origin: 'platform' });
  });

  it('a typed [audio:URL] is always a user address, even on a platform Endpoint', async () => {
    const message = { content: `听 [audio:${qqVoice}]`, metadata: {}, segments: [{ type: 'text', data: { text: `听 [audio:${qqVoice}]` } }] } as unknown as Message;
    const transcribe = transcriber();
    await preprocessInboundTurn(message, message.content, transcribe, { platformSegments: true });
    expect(transcribe).toHaveBeenCalledWith(qqVoice, { origin: 'user' });
  });

  it('runtime.sandbox Endpoints and unresolvable capabilities count as user-built segments', () => {
    const conversation = { endpoint: { id: 'ep', adapter: 'x' }, kind: 'private', id: 'c' } as never;
    const snapshotWith = (has: (path: string) => boolean) => ({
      projections: new Map([[adapterFeatureId, {
        $projection: 'zhin.adapter-index/1', capabilityProfile: () => undefined, turnCapabilities: () => ({ has }),
      }]]),
    }) as never;
    expect(inboundVoiceSegmentsFromPlatform(snapshotWith(() => false), conversation)).toBe(true);
    expect(inboundVoiceSegmentsFromPlatform(snapshotWith((path) => path === 'runtime.sandbox'), conversation)).toBe(false);
    expect(inboundVoiceSegmentsFromPlatform({ projections: new Map() } as never, conversation)).toBe(false);
    expect(inboundVoiceSegmentsFromPlatform(snapshotWith(() => { throw new Error('boom'); }), conversation)).toBe(false);

    // Real profiles: the Sandbox declares `runtime.sandbox`, a QQ-style adapter does not.
    const snapshotFor = (profile: AdapterCapabilityProfile) => ({
      projections: new Map([[adapterFeatureId, {
        $projection: 'zhin.adapter-index/1',
        capabilityProfile: () => profile,
        turnCapabilities: (_id: string, input: object) => resolveTurnCapabilities({ ...input, profile } as never),
      }]]),
    }) as never;
    expect(inboundVoiceSegmentsFromPlatform(snapshotFor({ default: { runtime: { sandbox: true } } }), conversation)).toBe(false);
    expect(inboundVoiceSegmentsFromPlatform(snapshotFor({ default: { delivery: { send: true } } }), conversation)).toBe(true);
  });
});
