/**
 * @internal zhinjs/zhin#1250: the command environment (`${prefix}`, `${menu}`, `${command.*}`) of
 * outbound templates. The IM runtime provides it from the same MessageDispatcher (and so the same
 * prefix resolver) the inbound command dispatch uses; nothing here reads adapter configuration
 * itself. Not exported from the package. The renderer reads it from the Root scope only, so a
 * Plugin binding the same id in its own scope changes nothing; reading it reveals no more than
 * `message.commandPrefix` / `message.commandMenu` already do.
 */
import { commandFeatureId } from '@zhin.js/command';
import type { ConversationRef } from '@zhin.js/im-contract';
import {
  createToken,
  type Locale,
  type PluginId,
  type RuntimeSnapshot,
  type TemplateCommandPaths,
} from '@zhin.js/plugin-runtime';
import { gatedCommandIndex } from './feature-gate.js';

export interface OutboundCommandEnvironmentInput {
  readonly conversation: ConversationRef;
  /** Endpoint instance name when the send answers an incoming message. */
  readonly endpointId?: string;
  readonly locale: Locale;
}

/** Resolve the prefix and menu entry of the account in `input.conversation`, as dispatch would. */
export type OutboundCommandEnvironment = (
  input: OutboundCommandEnvironmentInput,
  snapshot: RuntimeSnapshot,
) => Readonly<{ prefix: string; menu?: string }>;

export const outboundCommandEnvironmentToken = createToken<OutboundCommandEnvironment>(
  'zhin.im.outbound-command-environment',
  'Command prefix and menu of the sending account, resolved like inbound command dispatch',
);

/** `${command.*}` keys follow the template PATH rule: identifiers only, `-` written as `_`. */
const TEMPLATE_KEY = /^[A-Za-z_$][\w$]*$/u;
const BLOCKED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Bounds the per-send work; a plugin with more static commands keeps the first ones (tree order). */
const MAX_TEMPLATE_COMMANDS = 256;
/**
 * Shared, empty, frozen prototype: no functions or accessors anywhere, and nodes are not plain
 * objects, so `${command}` / `${command.group}` stay in the text instead of dumping JSON.
 */
const COMMAND_NODE: object = Object.freeze(Object.create(null));

/**
 * Frozen data properties only: the requester's own commands that this conversation can run,
 * written with `prefix`. A command that has subcommands is reachable only through them.
 */
export function templateCommandPaths(
  snapshot: RuntimeSnapshot,
  input: OutboundCommandEnvironmentInput,
  requester: PluginId,
  prefix: string,
): TemplateCommandPaths | undefined {
  const commands = gatedCommandIndex(input, snapshot);
  if (!commands) return undefined;
  const root: Record<string, unknown> = Object.create(COMMAND_NODE);
  let count = 0;
  for (const slot of snapshot.capabilities.values()) {
    if (slot.feature !== commandFeatureId || slot.owner !== requester) continue;
    if (count >= MAX_TEMPLATE_COMMANDS) break;
    const segments = slot.localName.split('/').filter(segment => !segment.startsWith('$'));
    const keys = segments.map(segment => segment.replaceAll('-', '_'));
    if (keys.length === 0 || keys.some(key => !TEMPLATE_KEY.test(key) || BLOCKED_KEYS.has(key))) continue;
    // Disabled owners and unknown paths yield undefined: nothing to write.
    const written = commands.formatCommand(requester, segments.join(' '), prefix, input.locale);
    if (written === undefined) continue;
    count++;
    let node = root;
    for (const key of keys.slice(0, -1)) {
      const next = node[key];
      if (typeof next === 'object' && next !== null) node = next as Record<string, unknown>;
      else node = node[key] = Object.create(COMMAND_NODE) as Record<string, unknown>;
    }
    const leaf = keys[keys.length - 1]!;
    // A command node with subcommands stays a node.
    if (typeof node[leaf] !== 'object') node[leaf] = written;
  }
  return count > 0 ? freezeDeep(root) as TemplateCommandPaths : undefined;
}

function freezeDeep(value: Record<string, unknown>): Record<string, unknown> {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) freezeDeep(child as Record<string, unknown>);
  }
  return Object.freeze(value);
}
