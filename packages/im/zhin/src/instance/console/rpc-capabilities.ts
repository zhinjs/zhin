/**
 * Which Console RPC types the instance answers (zhinjs/zhin#1250): the runtime dispatcher of
 * `@zhin.js/host-http` plus the instance's own slices (IAM, feature configuration, chat roles,
 * chat people and identities (ADR 0060), attention inbox, agent collaboration, plugin Console
 * RPC). It tells an RPC the instance has but forgot to map (audited `unmapped`) from one it does
 * not have (`unknown_rpc`, not audited), and it is the instance part of
 * `GET {base}/console/capabilities`.
 */
import { isRuntimeConsoleRpcType } from '@zhin.js/host-http';
import { isIamRpc } from '@zhin.js/gateway/iam';
import {
  AGENT_COLLABORATION_RPC,
  CONSOLE_FEATURES,
  CONSOLE_RPC_PERMISSIONS,
  PLUGIN_CONSOLE_RPC_PREFIX,
  createConsoleCapabilities,
  isConsoleAttentionRpcType,
  isConsoleChatPrincipalsRpcType,
  isConsoleChatRolesRpcType,
  isConsoleFeatureRpcType,
  type ConsoleCapabilities,
} from '@zhin.js/console-protocol';

const AGENT_COLLABORATION_TYPES: ReadonlySet<string> = new Set(Object.values(AGENT_COLLABORATION_RPC));

/** Built-in RPC types the instance handles (plugin RPC is a namespace, see below). */
function isBuiltinInstanceRpcType(type: string): boolean {
  return isRuntimeConsoleRpcType(type)
    || isIamRpc(type)
    || isConsoleFeatureRpcType(type)
    || isConsoleChatRolesRpcType(type)
    || isConsoleChatPrincipalsRpcType(type)
    || isConsoleAttentionRpcType(type)
    || AGENT_COLLABORATION_TYPES.has(type);
}

/**
 * Whether the instance has a handler for `type`. `plugin.*` belongs to the plugin RPC dispatcher:
 * a malformed plugin RPC there stays an audited refusal.
 */
export function isInstanceConsoleRpcType(type: string): boolean {
  return isBuiltinInstanceRpcType(type) || type.startsWith(PLUGIN_CONSOLE_RPC_PREFIX);
}

let cached: ConsoleCapabilities | undefined;

/** The instance's capability record: mapped built-in RPC types it handles, and its feature flags. */
export function instanceConsoleCapabilities(): ConsoleCapabilities {
  cached ??= createConsoleCapabilities({
    rpc: Object.keys(CONSOLE_RPC_PERMISSIONS).filter(isBuiltinInstanceRpcType),
    features: [CONSOLE_FEATURES.UNKNOWN_RPC_CODE, CONSOLE_FEATURES.DENIAL_REASONS, CONSOLE_FEATURES.PLUGIN_RPC],
  });
  return cached;
}
