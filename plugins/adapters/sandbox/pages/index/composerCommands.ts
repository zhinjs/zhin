import type { MessageSegment } from '@zhin.js/client';
import { getSandboxApiBase, getSandboxAuthHeaders, type SandboxRequestContext } from './sandboxTransport.js';
import type { SandboxScope } from './agentTrace.js';
import type { PlaygroundMessage } from './playgroundState.js';

/**
 * Host marker of a human approval prompt (#1250): `UserInteractionRequest.purpose = 'approval'`
 * is rendered by Core as keyboard `data.purpose`. Any segment carrying it marks the message, so a
 * text-only approval card that sets the same field on its body is recognised too.
 */
export const APPROVAL_PURPOSE = 'approval';

/** Only real approval prompts get the "needs your confirmation" label, not game cards or menu pages. */
export function isApprovalPrompt(message: Pick<PlaygroundMessage, 'type' | 'interactionReadOnly' | 'content'>): boolean {
  return message.type === 'received' && message.interactionReadOnly !== true
    && message.content.some((segment: MessageSegment) => {
      const data = segment.data as Record<string, unknown> | undefined;
      return data !== null && typeof data === 'object' && data.purpose === APPROVAL_PURPOSE;
    });
}

/** What `GET /api/conversations/workspaces/commands` returns for the live Sandbox binding. */
export interface SandboxCommandHints {
  readonly prefix: string;
  readonly menu?: string;
  readonly quick: readonly string[];
}

/** Quick commands of the Host's command index; null when the Host cannot tell (older Host, no binding). */
export async function readSandboxCommandHints(
  connectionId: string,
  scene: Readonly<{ type: SandboxScope; id: string }>,
  locale: string,
  signal?: AbortSignal,
  context?: SandboxRequestContext,
): Promise<SandboxCommandHints | null> {
  const url = new URL('/api/conversations/workspaces/commands', `${(context ? context.apiBase : getSandboxApiBase()) || window.location.origin}/`);
  url.searchParams.set('connectionId', connectionId);
  url.searchParams.set('type', scene.type);
  url.searchParams.set('id', scene.id);
  url.searchParams.set('locale', locale);
  try {
    const response = await fetch(url, { headers: context?.headers ?? getSandboxAuthHeaders(), signal });
    if (!response.ok) return null;
    const body = await response.json() as { success?: boolean; data?: Partial<SandboxCommandHints> };
    const data = body?.data;
    if (!body?.success || !data || typeof data.prefix !== 'string' || !Array.isArray(data.quick)) return null;
    return Object.freeze({
      prefix: data.prefix,
      ...(typeof data.menu === 'string' ? { menu: data.menu } : {}),
      quick: Object.freeze(data.quick.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6)),
    });
  } catch {
    return null;
  }
}
