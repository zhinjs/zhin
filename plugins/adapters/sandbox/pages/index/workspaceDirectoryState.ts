import type { PlaygroundSession } from './playgroundState.js';
import { readWorkspaceDirectory, saveWorkspaceConversation, type SandboxWorkspaceScope, type WorkspaceDirectory } from './workspaceDirectory.js';
import { captureSandboxRequestContext, type SandboxRequestContext } from './sandboxTransport.js';

export type WorkspaceDirectoryMode = 'loading' | 'server' | 'browser' | 'error';
export interface DirectoryStatus { readonly mode: WorkspaceDirectoryMode; readonly error: string | null; }
interface WriteJob { desired?: PlaygroundSession; pending?: Promise<void>; blocked?: boolean; error?: string; }
interface DirectoryOwner {
  readonly host: string;
  readonly connectionId?: string;
  readonly controller: AbortController;
  readonly requestContext: SandboxRequestContext;
  active: boolean;
  mode: WorkspaceDirectoryMode;
  scope?: SandboxWorkspaceScope;
  revisions: Map<string, string>;
  writes: Map<string, WriteJob>;
  pendingRead?: Promise<void>;
}

export function createWorkspaceDirectoryController(options: Readonly<{
  loaded(directory: WorkspaceDirectory | null, sameScope: boolean): void;
  status(status: DirectoryStatus): void;
  read?: typeof readWorkspaceDirectory;
  save?: typeof saveWorkspaceConversation;
}>) {
  let current: DirectoryOwner | undefined;
  let previous: { host: string; scope?: SandboxWorkspaceScope; browser: boolean } | undefined;
  const read = options.read ?? readWorkspaceDirectory;
  const save = options.save ?? saveWorkspaceConversation;
  const owns = (owner: DirectoryOwner) => current === owner && owner.active;
  const publish = (owner: DirectoryOwner, error: string | null = null) => {
    if (owns(owner)) options.status({ mode: owner.mode, error });
  };
  const load = (owner: DirectoryOwner): Promise<void> => {
    if (owner.pendingRead) return owner.pendingRead;
    const run = async () => {
      owner.mode = 'loading'; publish(owner);
      try {
        const result = owner.connectionId ? await read(owner.connectionId, owner.controller.signal, owner.requestContext) : null;
        if (!owns(owner)) return;
        const sameScope = previous?.host === owner.host && (result
          ? Boolean(previous.scope && sameWorkspaceScope(previous.scope, result.scope))
          : previous.browser);
        owner.scope = result?.scope;
        owner.mode = result ? 'server' : 'browser';
        owner.revisions = new Map(result?.items.map(item => [sceneKey(item), item.revision]) ?? []);
        owner.writes.clear();
        previous = { host: owner.host, scope: owner.scope, browser: result === null };
        options.loaded(result, sameScope);
        publish(owner);
      } catch (error) {
        if (!owns(owner)) return;
        owner.mode = 'error';
        publish(owner, error instanceof Error ? error.message : String(error));
      }
    };
    owner.pendingRead = run().finally(() => { owner.pendingRead = undefined; });
    return owner.pendingRead;
  };
  const retire = () => {
    if (!current) return;
    current.active = false;
    current.controller.abort();
    // Already sent mutations settle once. Unsent desired state never follows a retired socket.
    for (const job of current.writes.values()) job.desired = undefined;
    current = undefined;
  };
  return {
    begin(input: Readonly<{ host: string; connectionId?: string; canExecute: boolean; requestContext?: SandboxRequestContext }>): Promise<void> {
      retire();
      const owner: DirectoryOwner = { host: input.host, connectionId: input.canExecute ? input.connectionId : undefined,
        requestContext: input.requestContext ?? { ...captureSandboxRequestContext(), apiBase: input.host },
        controller: new AbortController(), active: true, mode: 'loading', revisions: new Map(), writes: new Map() };
      current = owner;
      return load(owner);
    },
    retire,
    async refresh(): Promise<void> {
      const owner = current;
      if (!owner) return;
      await Promise.all([...owner.writes.values()].flatMap(job => job.pending ? [job.pending] : []));
      if (owns(owner)) await load(owner);
    },
    save(conversation: PlaygroundSession, onlyNew = false): Promise<void> {
      const owner = current;
      if (!owner || owner.mode !== 'server' || !owner.connectionId) return Promise.resolve();
      const key = sceneKey(conversation);
      if (onlyNew && (owner.revisions.has(key) || owner.writes.has(key))) return owner.writes.get(key)?.pending ?? Promise.resolve();
      const job = owner.writes.get(key) ?? {};
      owner.writes.set(key, job);
      if (job.blocked) return Promise.resolve();
      job.desired = { ...conversation, runConfig: { ...conversation.runConfig } };
      if (job.pending) return job.pending;
      const run = async () => {
        while (owns(owner) && job.desired) {
          const desired = job.desired;
          job.desired = undefined;
          try {
            const result = await save(owner.connectionId!, desired, owner.revisions.get(key) ?? null, owner.requestContext);
            if (!owns(owner)) return;
            if (!owner.scope || !sameWorkspaceScope(owner.scope, result.scope)) throw Error('Conversation save returned a different workspace');
            owner.revisions.set(key, result.item.revision);
          } catch (error) {
            if (!owns(owner)) return;
            job.blocked = true;
            job.desired = undefined;
            job.error = error instanceof Error ? error.message : String(error);
          }
          publish(owner, [...owner.writes.values()].find(item => item.error)?.error ?? null);
          if (job.blocked) return;
        }
      };
      // Install the pending promise before execution can settle and clear it.
      job.pending = Promise.resolve().then(run).finally(() => { job.pending = undefined; });
      return job.pending;
    },
  };
}

function sceneKey(scene: Pick<PlaygroundSession, 'id' | 'type'>): string { return `${scene.type}\0${scene.id}`; }
function sameWorkspaceScope(left: SandboxWorkspaceScope, right: SandboxWorkspaceScope): boolean {
  return left.endpoint.adapter === right.endpoint.adapter && left.endpoint.id === right.endpoint.id && left.ownerId === right.ownerId;
}
