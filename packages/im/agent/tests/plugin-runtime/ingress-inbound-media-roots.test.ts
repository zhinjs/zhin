import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@zhin.js/core';
import { createRuntimeTurnRequest } from '../../src/plugin-runtime/ingress/request.js';

/** #1250: the trusted ingress hands the producing Endpoint's declared roots to the Turn. */
function message(segments: readonly unknown[]): Message {
  return {
    conversation: { endpoint: { id: 'root/adapter/weixin-ilink', adapter: 'weixin-ilink' }, kind: 'private', id: 'u-1' },
    endpointId: 'wx',
    sender: { id: 'u-1' },
    content: 'hi',
    segments,
  } as unknown as Message;
}

function request(segments: readonly unknown[], roots: () => readonly string[]) {
  return createRuntimeTurnRequest({ message: message(segments), text: 'hi', roles: {} as never }, {
    traceId: 't', turnId: 'turn-1', signal: new AbortController().signal,
    projectRoot: '/project', workspaceRoot: '/project', sessionKey: 'session-1',
    intent: { kind: 'new' }, ports: {} as never,
    inboundMediaRoots: roots,
    resolveReference: async () => ({ status: 'not_found', code: 'x' }),
  });
}

describe('createRuntimeTurnRequest inbound media roots', () => {
  it('reads the declared roots only for a message carrying a local path (or a platform ref)', () => {
    const roots = vi.fn(() => ['/data/wx/media/inbound']);
    const withPath = request([{ type: 'image', data: { media: { kind: 'path', value: '/data/wx/media/inbound/a.png' } } }], roots);
    expect(withPath.input.inboundMediaRoots).toEqual(['/data/wx/media/inbound']);
    expect(withPath.input.media?.[0]?.source).toEqual({ kind: 'path', value: '/data/wx/media/inbound/a.png' });

    roots.mockClear();
    const urlOnly = request([{ type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/a.png' } } }], roots);
    expect(roots).not.toHaveBeenCalled();
    expect(urlOnly.input.inboundMediaRoots).toBeUndefined();
  });

  it('a legacy `data.file` that looks like a local path stays an opaque platform reference', () => {
    const roots = vi.fn(() => [] as string[]);
    const turn = request([{ type: 'image', data: { file: '/root/project/.env' } }], roots);
    expect(turn.input.media?.[0]?.source).toEqual({ kind: 'platform_ref', value: '/root/project/.env' });
    expect(turn.input.inboundMediaRoots).toBeUndefined();
  });
});
