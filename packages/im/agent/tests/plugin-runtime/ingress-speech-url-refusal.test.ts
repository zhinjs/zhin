import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@zhin.js/core';
import { admitIngressMailTurn } from '../../src/plugin-runtime/ingress/ingress-outbound.js';
import { SPEECH_URL_BLOCKED_NOTE } from '../../src/plugin-runtime/ingress/content.js';

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
      senderRoles: { isMaster: false } as never,
      plainText: true,
      liveRoom: false,
      mergeable: false,
      turnAccess: {} as never,
      audit: vi.fn(),
      reply,
    });

    expect(transcribeUrl).toHaveBeenCalledWith('https://10.0.0.8/secret.ogg');
    expect(result.kind).toBe('admitted');
    const text = `帮我听一下\n${SPEECH_URL_BLOCKED_NOTE}`;
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ text }));
    expect(result.kind === 'admitted' && result.inbound).toEqual({ text, sttApplied: false, sttRefusal: 'speech_url_blocked' });
    expect(reply).not.toHaveBeenCalled();
  });
});
