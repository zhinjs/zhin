/**
 * Instance side of the gateway's hot plugin enable / disable (zhinjs/zhin#1250, ADR 0054 §4
 * addendum 2026-11-15). The gateway writes `disable_plugins`, then sends `plugins.apply`; the
 * instance applies the root configuration at that revision as one generation transaction (the
 * same path as a Console configuration apply: retire the disabled instance's Scope and
 * capabilities, or assemble and commit the enabled one) and answers `plugins.apply.result`.
 *
 * The committed generation is the evidence: `applied` only when the instance is (or is no
 * longer) in the committed tree. A Runtime that kept the previous state for a process restart
 * answers `restart-required` with its reason codes; anything else is `failed` and the gateway
 * falls back to its stop → start transaction.
 */
import type { ConfigApplicationResult, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  INSTANCE_BRIDGE_FEATURES,
  type GatewayToInstanceMessage,
  type InstanceToGatewayMessage,
  type PluginApplyPayload,
  type PluginApplyResultPayload,
} from '@zhin.js/host-http/bridge';

/** The parts of the Root runtime the handler drives. */
export interface PluginApplyRuntime {
  applyConfiguration(expectedSourceRevision?: string): Promise<ConfigApplicationResult>;
  readonly snapshot: RuntimeSnapshot;
}

export interface PluginApplyChannel {
  onMessage(listener: (message: GatewayToInstanceMessage) => void): () => void;
  send(message: InstanceToGatewayMessage): void;
}

export interface PluginApplyChannelOptions {
  readonly channel: PluginApplyChannel;
  readonly runtime: PluginApplyRuntime;
  /** Diagnostics of a failed apply (never part of the outcome). */
  readonly onError?: (error: unknown, request: PluginApplyPayload) => void;
}

/** `ready.features` entry of an instance that answers `plugins.apply`. */
export const PLUGIN_APPLY_FEATURE = INSTANCE_BRIDGE_FEATURES.PLUGINS_APPLY;

const MAX_MESSAGE_LENGTH = 512;

/** Answers `plugins.apply`; returns the unsubscribe function. Requests run one at a time. */
export function installPluginApplyChannel(options: PluginApplyChannelOptions): () => void {
  let tail: Promise<void> = Promise.resolve();
  return options.channel.onMessage((message) => {
    if (message.type !== 'plugins.apply') return;
    const { id, payload } = message;
    tail = tail.then(async () => {
      const result = await applyPluginToggle(options.runtime, payload, options.onError);
      options.channel.send({ type: 'plugins.apply.result', id, payload: result });
    }).catch(() => undefined);
  });
}

/** Applies one enable / disable and classifies the committed result. */
export async function applyPluginToggle(
  runtime: PluginApplyRuntime,
  request: PluginApplyPayload,
  onError?: (error: unknown, request: PluginApplyPayload) => void,
): Promise<PluginApplyResultPayload> {
  let application: ConfigApplicationResult;
  try {
    application = await runtime.applyConfiguration(request.revision);
  } catch (error) {
    try { onError?.(error, request); } catch { /* diagnostics never change the outcome */ }
    return Object.freeze({ outcome: 'failed', generation: runtime.snapshot.generation, message: redact(error) });
  }
  const generation = runtime.snapshot.generation;
  if (inCommittedTree(runtime.snapshot, request.instanceKey) === request.enabled) {
    return Object.freeze({ outcome: 'applied', generation });
  }
  // Only groups about this instance or the plugin declarations explain why it did not apply.
  const relevant = application.groups.filter(group => group.id === `plugin-host:${request.instanceKey}` || group.paths.some(path =>
    path[0] === 'disable_plugins' || path[0] === 'plugins' || path[0] === request.instanceKey));
  const restart = relevant.filter(group => group.status === 'restart-pending');
  if (restart.length) {
    return Object.freeze({
      outcome: 'restart-required', generation,
      reasons: Object.freeze([...new Set(restart.map(group => group.reasonCode ?? group.id))].slice(0, 32)),
    });
  }
  const failed = relevant.find(group => group.status !== 'applied');
  return Object.freeze({
    outcome: 'failed', generation,
    message: failed
      ? `configuration group ${failed.id} is ${failed.status}${failed.reasonCode ? ` (${failed.reasonCode})` : ''}`
      : `plugin instance ${request.instanceKey} is still ${request.enabled ? 'disabled' : 'enabled'} after the apply`,
  });
}

function inCommittedTree(snapshot: RuntimeSnapshot, instanceKey: string): boolean {
  for (const node of snapshot.tree.values()) {
    if (node.parent === snapshot.root && node.instanceKey === instanceKey) return true;
  }
  return false;
}

function redact(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_MESSAGE_LENGTH);
}
