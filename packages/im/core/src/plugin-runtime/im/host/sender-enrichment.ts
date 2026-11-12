/**
 * ADR 0056: inbound sender roles come from {@link ChatRoleService} (stored grants only), never from
 * configuration lists or platform standing. This module wires that model into the IM Runtime hosts.
 */
import { isAdapterIndex, type AdapterIndex } from '@zhin.js/adapter';
import type { OperationSession } from '@zhin.js/feature-kit';
import type { CapabilityId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  createChatRoleSenderEnricher, type ChatRoleService,
} from '../../../built/roles.js';
import type { ImRuntime } from '../im-runtime.js';

export type ConfigurationChatAuthorizer = (session: OperationSession<string>, adapters: AdapterIndex) => boolean;

export interface SenderEnricherOptions {
  /** Chat role resolution of the instance; undefined while it is not available. */
  readonly roles: () => ChatRoleService | undefined;
}

/** `ImRuntime` `enrichSender` option over the chat role model. */
export function createSenderEnricher(options: SenderEnricherOptions): NonNullable<NonNullable<ConstructorParameters<typeof ImRuntime>[0]>['enrichSender']> {
  const enrich = createChatRoleSenderEnricher(options);
  return (sender, conversation, snapshot) => enrich(sender, conversation, snapshot);
}

function instanceAlias(snapshot: Pick<RuntimeSnapshot, 'tree'> | undefined, owner: string): string | undefined {
  try { return snapshot?.tree.get(owner as never)?.instanceKey; } catch { return undefined; }
}

/**
 * Whether the operation's sender holds `owner` on the Adapter that received it — at its adapter
 * scope (or globally), or on *any* configured endpoint of that same Adapter. The identity stays on
 * the receiving Adapter; owners of other Adapters (including another instance of the same Adapter
 * package) never qualify. Removed / retiring endpoints never qualify.
 */
export function senderOwnsReceivingAdapter(
  session: OperationSession<string>,
  adapters: AdapterIndex,
  roles: ChatRoleService | undefined,
  snapshot: Pick<RuntimeSnapshot, 'tree'> | undefined,
): boolean {
  if (!session.sender?.id || !isAdapterIndex(adapters) || session.signal.aborted) return false;
  const id = session.scene.endpoint.id as CapabilityId;
  const adapter = adapters.adapterForEndpoint(id);
  const child = adapter?.find(id);
  if (!adapter || !child || session.adapter !== adapter || session.endpoint !== adapter.getEndpoint(child.desired.instanceId)) return false;
  if (!child.started) return false;
  const alias = instanceAlias(snapshot, adapter.descriptor.owner);
  if (!roles || !alias) return false;
  const identity = { adapter: alias, userId: session.sender.id };
  const owns = (key: string) => { try { return roles.hasRole(identity, key, 'owner'); } catch { return false; } };
  if (owns(alias)) return true;
  return adapter.list().some(entry => !entry.removed && !entry.retiring && owns(`${alias}/${entry.endpointId}`));
}

/**
 * Whether the operation's sender (identity on the receiving Adapter) is a **global** `owner`
 * (ADR 0056 §2): host-wide operations — restarting the instance, editing the project
 * configuration — need it; owners of an adapter, account or conversation do not qualify.
 */
export function senderIsGlobalOwner(
  session: OperationSession<string>,
  adapters: AdapterIndex,
  roles: ChatRoleService | undefined,
  snapshot: Pick<RuntimeSnapshot, 'tree'> | undefined,
): boolean {
  if (!session.sender?.id || !isAdapterIndex(adapters) || session.signal.aborted || !roles) return false;
  const id = session.scene.endpoint.id as CapabilityId;
  const adapter = adapters.adapterForEndpoint(id);
  const child = adapter?.find(id);
  if (!adapter || !child || session.adapter !== adapter || session.endpoint !== adapter.getEndpoint(child.desired.instanceId)) return false;
  if (!child.started) return false;
  const alias = instanceAlias(snapshot, adapter.descriptor.owner);
  if (!alias) return false;
  try { return roles.hasRole({ adapter: alias, userId: session.sender.id }, '', 'owner'); } catch { return false; }
}

/**
 * In-chat configuration authority (C2): private chats only, and the sender is a global owner —
 * `config set` edits the project configuration, a host-wide capability (ADR 0056 §2).
 */
export function createConfigurationChatAuthorizer(
  roles: () => ChatRoleService | undefined,
  snapshot: () => Pick<RuntimeSnapshot, 'tree'> | undefined = () => undefined,
): ConfigurationChatAuthorizer {
  return (session, adapters) => session.scene.kind === 'private'
    && senderIsGlobalOwner(session, adapters, roles(), snapshot());
}
