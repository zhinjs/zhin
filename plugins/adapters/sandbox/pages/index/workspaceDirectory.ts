import type { PlaygroundSession } from './playgroundState.js';
import { getSandboxApiBase, getSandboxAuthHeaders, type SandboxRequestContext } from './sandboxTransport.js';

export interface SandboxWorkspaceScope {
  readonly endpoint: Readonly<{ adapter: string; id: string }>;
  readonly endpointKey: string;
  readonly ownerId: string;
  readonly connectionId: string;
}

export interface WorkspaceConversation extends Pick<PlaygroundSession, 'id' | 'type' | 'name' | 'runConfig'> {
  readonly revision: string;
  readonly updatedAt: number;
}

export interface WorkspaceDirectory {
  readonly scope: SandboxWorkspaceScope;
  readonly items: readonly WorkspaceConversation[];
}

export class WorkspaceRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

interface WorkspaceResponse<T> {
  readonly success?: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly code?: string;
}

function directoryUrl(connectionId: string, context?: SandboxRequestContext): URL {
  const url = new URL('/api/conversations/workspaces', `${(context ? context.apiBase : getSandboxApiBase()) || window.location.origin}/`);
  url.searchParams.set('connectionId', connectionId);
  return url;
}

/** Only an absent endpoint or explicitly unavailable store permits the agreed browser fallback. */
export async function readWorkspaceDirectory(connectionId: string, signal?: AbortSignal, context?: SandboxRequestContext): Promise<WorkspaceDirectory | null> {
  const response = await fetch(directoryUrl(connectionId, context), { headers: context?.headers ?? getSandboxAuthHeaders(), signal });
  if (response.status === 404 || response.status === 405) return null;
  const body = await response.json() as WorkspaceResponse<WorkspaceDirectory>;
  if (response.status === 503 && body.code === 'workspace_store_unavailable') return null;
  if (!response.ok || !body.success || !body.data) {
    throw new WorkspaceRequestError(body.error || `Conversation directory request failed (${response.status})`, response.status, body.code);
  }
  if (body.data.scope.connectionId !== connectionId || !Array.isArray(body.data.items)) {
    throw new WorkspaceRequestError('Conversation directory returned a different connection or invalid catalog', response.status);
  }
  return body.data;
}

/** One revision-checked mutation. An unknown outcome or conflict must never cause a blind retry. */
export async function saveWorkspaceConversation(
  connectionId: string,
  conversation: Pick<PlaygroundSession, 'id' | 'type' | 'name' | 'runConfig'>,
  expectedRevision: string | null,
  context?: SandboxRequestContext,
): Promise<Readonly<{ scope: SandboxWorkspaceScope; item: WorkspaceConversation }>> {
  const response = await fetch(directoryUrl(connectionId, context), {
    method: 'PUT', headers: { ...(context?.headers ?? getSandboxAuthHeaders()), 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId, conversation: {
      id: conversation.id, type: conversation.type, name: conversation.name, runConfig: conversation.runConfig,
    }, expectedRevision }),
  });
  const body = await response.json() as WorkspaceResponse<{ scope: SandboxWorkspaceScope; item: WorkspaceConversation }>;
  if (!response.ok || !body.success || !body.data) {
    throw new WorkspaceRequestError(body.error || `Conversation save failed (${response.status})`, response.status, body.code);
  }
  if (body.data.scope.connectionId !== connectionId || body.data.item.id !== conversation.id || body.data.item.type !== conversation.type) {
    throw new WorkspaceRequestError('Conversation save returned a different connection or scene', response.status);
  }
  return body.data;
}
