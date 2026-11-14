/**
 * Quick commands for the Sandbox composer (#1250): built from the live command index and the
 * endpoint's real `commandPrefix`, so the page never offers a hard-coded command that this
 * project does not answer (`/help` on an endpoint without a prefix, a `ping` nobody registered).
 */
import { isCommandIndex, commandFeatureId } from '@zhin.js/command';
import { MessageDispatcher, type Message } from '@zhin.js/core/runtime';
import {
  capabilityId, disabledFeatureOwners, resolveEndpointFeatureKey,
  type Locale, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { SandboxWorkspaceScope } from './sandbox-workspace-scope.js';

export interface SandboxQuickCommands {
  /** The endpoint's effective command prefix (`''` = commands without a prefix). */
  readonly prefix: string;
  /** The command menu entry as a user types it (prefix included); absent when the menu is off. */
  readonly menu?: string;
  /** Ready-to-send command texts, menu first; only commands this conversation can run. */
  readonly quick: readonly string[];
}

/**
 * Parameterless everyday commands offered after the menu when a plugin registers them, by the
 * command's stable local name (its directory route), not its localized display name: a `ping`
 * whose Chinese preferred alias is `测试` is still found, and is offered under that alias.
 */
const PREFERRED = ['ping', 'status'] as const;
const MAX_QUICK = 4;

export function sandboxQuickCommands(
  scope: Pick<SandboxWorkspaceScope, 'endpoint' | 'endpointKey'>,
  snapshot: RuntimeSnapshot,
  conversation: Readonly<{ kind: 'private' | 'group' | 'channel'; id: string }>,
  locale: Locale,
): SandboxQuickCommands {
  // The same environment the inbound dispatcher computes for a message in this conversation.
  const probe = {
    conversation: { endpoint: scope.endpoint, kind: conversation.kind, id: conversation.id },
    endpointId: scope.endpointKey,
    locale,
  } as unknown as Message;
  const environment = new MessageDispatcher().commandEnvironment(probe, snapshot);
  const quick: string[] = environment.menu ? [environment.menu] : [];
  const index = snapshot.projections.get(commandFeatureId);
  if (isCommandIndex(index)) {
    const key = resolveEndpointFeatureKey(snapshot, scope.endpoint.id, scope.endpointKey, conversation);
    const disabled = disabledFeatureOwners(snapshot, snapshot.tree.keys(), key);
    const commands = index.list(locale);
    for (const name of PREFERRED) {
      if (quick.length >= MAX_QUICK) break;
      const command = commands.find(item => item.id === capabilityId(item.owner, commandFeatureId, name));
      if (!command || disabled.has(command.owner) || command.permit?.length
        || (command.adapter && command.adapter !== scope.endpoint.adapter)
        || command.parameters.some(parameter => parameter.required)) continue;
      const text = `${environment.prefix}${command.name}`;
      if (!quick.includes(text)) quick.push(text);
    }
  }
  return Object.freeze({ prefix: environment.prefix, ...(environment.menu ? { menu: environment.menu } : {}), quick: Object.freeze(quick) });
}
