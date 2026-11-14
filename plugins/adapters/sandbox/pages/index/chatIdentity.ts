import { getSandboxApiBase, getSandboxAuthHeaders, type SandboxRequestContext } from './sandboxTransport.js';

/**
 * ADR 0060 §5.4: who a Sandbox message speaks as. The server decides from the authenticated
 * Console principal; the page only asks (`asMe`) and shows what the server answered.
 */
export type SandboxSpeakerMode = 'me' | 'simulated';

/** Why 「以我的聊天身份发言」 could not be used for a message (`asMeUnavailable` on the echo). */
export type SandboxAsMeUnavailable = 'no-console-user' | 'no-identity';

/** The server's answer for the last message this page sent. */
export interface SandboxServerSpeaker {
  readonly senderId: string;
  /** The id as typed (simulated) or the linked identity (me). */
  readonly displaySenderId: string;
  readonly simulated: boolean;
  readonly chatRole?: string;
  readonly trustLevel: string;
  readonly asMeUnavailable?: SandboxAsMeUnavailable;
}

/** Reads the speaker fields of an inbound echo; null on frames from an older Host without them. */
export function readServerSpeaker(frame: Readonly<Record<string, unknown>>): SandboxServerSpeaker | null {
  if (typeof frame.senderId !== 'string' || typeof frame.senderTrustLevel !== 'string') return null;
  const simulated = frame.simulated === true;
  const unavailable = frame.asMeUnavailable === 'no-console-user' || frame.asMeUnavailable === 'no-identity' ? frame.asMeUnavailable : undefined;
  return Object.freeze({
    senderId: frame.senderId,
    displaySenderId: typeof frame.displaySenderId === 'string' && frame.displaySenderId ? frame.displaySenderId : frame.senderId,
    simulated,
    trustLevel: frame.senderTrustLevel,
    ...(typeof frame.senderChatRole === 'string' && frame.senderChatRole ? { chatRole: frame.senderChatRole } : {}),
    ...(unavailable ? { asMeUnavailable: unavailable } : {}),
  });
}

/** Whether a send should ask to speak as the linked identity (only when the socket has a Console user). */
export function wantsAsMe(mode: SandboxSpeakerMode, consoleUser: boolean): boolean {
  return mode === 'me' && consoleUser;
}

/**
 * `chat-identities.simulated.ensure`: gives the caller's person an identity on the Sandbox (and
 * links a new person to the caller when there is none). `unsupported` on a Host without the RPC.
 */
export async function ensureSandboxChatIdentity(context?: SandboxRequestContext, signal?: AbortSignal):
  Promise<{ readonly status: 'ok' } | { readonly status: 'unsupported' } | { readonly status: 'failed'; readonly message: string }> {
  const url = new URL('/api/console/request', `${(context ? context.apiBase : getSandboxApiBase()) || window.location.origin}/`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...(context?.headers ?? getSandboxAuthHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'chat-identities.simulated.ensure', data: {}, requestId: `sandbox-identity-${Date.now()}` }),
      ...(signal ? { signal } : {}),
    });
    const body = await response.json().catch(() => null) as { success?: boolean; error?: unknown; code?: unknown } | null;
    if (response.ok && body?.success) return { status: 'ok' };
    // Older Hosts refuse an RPC they do not list (`unmapped`) or answer 未知请求.
    if (response.status === 404 || body?.code === 'unmapped' || body?.code === 'unknown_rpc' || body?.error === '未知请求') return { status: 'unsupported' };
    return { status: 'failed', message: typeof body?.error === 'string' && body.error ? body.error : `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
