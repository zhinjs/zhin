import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@zhin.js/core/runtime';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
  resolveStableSenderId,
  SPEECH_URL_BLOCKED_NOTE,
  stringMetadata,
} from '@zhin.js/agent/runtime';

describe('Agent turn content boundary', () => {
  it('uses authenticated sender identity and canonical string metadata', () => {
    expect(resolveStableSenderId({ sender: { id: 'user-1' } } as Message)).toBe('user-1');
    expect(resolveStableSenderId({} as Message)).toBe('anon');
    expect(stringMetadata({ projectId: ' zhin ' }, 'projectId')).toBe('zhin');
    expect(stringMetadata({ projectId: 1 }, 'projectId')).toBeUndefined();
  });

  it('recognizes only exact clear commands', () => {
    expect(isClearCommand(' /CLEAR ')).toBe(true);
    expect(isClearCommand('清空')).toBe(true);
    expect(isClearCommand('please clear')).toBe(false);
  });

  it('transcribes one canonical inbound audio URL and preserves surrounding text', async () => {
    const transcribe = vi.fn(async () => 'voice transcript');
    const message = {
      segments: [{
        type: 'audio',
        data: { media: { kind: 'url', value: 'https://media.example/voice.mp3' } },
      }],
      metadata: {},
      content: '[audio:https://media.example/voice.mp3]',
    } as unknown as Message;

    await expect(preprocessInboundTurn(
      message,
      'context [audio:https://media.example/voice.mp3]',
      transcribe,
    )).resolves.toEqual({ text: 'context\nvoice transcript', sttApplied: true });
    expect(transcribe).toHaveBeenCalledWith('https://media.example/voice.mp3');
  });

  it('keeps the turn going with a note when the voice address is refused (#1250 第 45 批)', async () => {
    const transcribe = vi.fn(async () => ({ status: 'refused' as const, code: 'speech_url_blocked' as const }));
    const message = {
      metadata: {},
      content: 'hi [audio:http://169.254.169.254/latest/meta-data/]',
    } as unknown as Message;

    const result = await preprocessInboundTurn(message, message.content, transcribe);
    expect(result).toEqual({
      text: `hi\n${SPEECH_URL_BLOCKED_NOTE}`,
      sttApplied: false,
      sttRefusal: 'speech_url_blocked',
    });
    expect(result.text).not.toContain('169.254.169.254');
    expect(transcribe).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data/');

    const voiceOnly = { metadata: {}, content: '[audio:https://10.0.0.1/a.ogg]' } as unknown as Message;
    await expect(preprocessInboundTurn(voiceOnly, voiceOnly.content, transcribe))
      .resolves.toMatchObject({ text: SPEECH_URL_BLOCKED_NOTE, sttApplied: false });
  });

  it('does not end the turn when the transcriber throws', async () => {
    const message = { metadata: {}, content: 'hello [audio:https://media.example/a.ogg]' } as unknown as Message;
    await expect(preprocessInboundTurn(message, message.content, async () => { throw new Error('boom'); }))
      .resolves.toEqual({ text: 'hello', sttApplied: false });
  });

  it('maps completed output and rejects terminal non-completed outcomes', () => {
    expect(completedOutput({ status: 'completed', output: [{ type: 'text', content: 'ok' }] } as never))
      .toEqual([{ type: 'text', content: 'ok' }]);
    expect(() => completedOutput({ status: 'cancelled', reason: 'superseded' } as never))
      .toThrow('Agent turn cancelled: superseded');
    expect(() => completedOutput({ status: 'budget_exceeded', budget: 'steps' } as never))
      .toThrow('Agent turn exceeded budget: steps');
  });

  it('flattens outbound elements into stable text fallbacks', () => {
    expect(flattenOutputElements([
      { type: 'text', content: 'hello' },
      { type: 'image', url: 'https://media.example/a.png' },
      { type: 'audio', fallbackText: 'audio transcript' },
      { type: 'card', title: 'Status', description: 'Ready' },
      { type: 'file', name: 'report.pdf', url: 'https://files.example/report.pdf' },
    ])).toBe([
      'hello',
      '[image:https://media.example/a.png]',
      'audio transcript',
      'Status\nReady',
      'report.pdf: https://files.example/report.pdf',
    ].join('\n'));
  });
});
