import { interactionMessages as t } from '../../built/interaction-messages.js';
import { randomUUID } from 'node:crypto';
import { jsx } from '@zhin.js/jsx';
import { conversationRefKey, type Segment } from '@zhin.js/im-contract';
import { bindOperationInput } from '@zhin.js/feature-kit';
import type { PluginId, PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ButtonProps, ButtonClickHandler } from '../../jsx/message-tags.js';
import type { Message, SendRequest } from './contracts.js';
import { operationEndpoint } from './operation-endpoint.js';
import { isKeyboardSegment } from '../../built/interactive-segments/types.js';

const PREFIX = 'zhin:jsx:';
const BUTTON_TTL_MS = 60 * 60 * 1000;

export function isJsxButtonPayload(payload: string | undefined): boolean {
  return payload?.startsWith(PREFIX) === true;
}

export interface PluginIncarnationRef {
  readonly requester: PluginId;
  readonly snapshot: RuntimeSnapshot;
  readonly node: PluginNodeSnapshot | undefined;
  readonly signal?: AbortSignal;
}

function hasIdenticalPluginTree(
  left: ReadonlyMap<PluginId, PluginNodeSnapshot>,
  right: ReadonlyMap<PluginId, PluginNodeSnapshot>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [id, node] of left) {
    if (right.get(id) !== node) return false;
  }
  return true;
}

/**
 * Checks whether the plugin incarnation that registered a callback/interaction
 * is still live in `currentSnapshot`.
 * Survives HMR of unrelated plugins (where another plugin's node in `tree` changed
 * while `origin.node` is unchanged), while retiring if the owning plugin was reloaded/removed,
 * its endpoint signal aborted, or the runtime performed a full-generation retirement.
 */
export function isPluginIncarnationAlive(
  origin: PluginIncarnationRef,
  currentSnapshot: RuntimeSnapshot,
): boolean {
  if (origin.signal?.aborted) {
    return false;
  }
  if (origin.snapshot === currentSnapshot) {
    return true;
  }
  if (!origin.node || hasIdenticalPluginTree(origin.snapshot.tree, currentSnapshot.tree)) {
    return false;
  }
  const currentNode = currentSnapshot.tree.get(origin.requester);
  return currentNode !== undefined && currentNode === origin.node;
}

interface ButtonBinding extends PluginIncarnationRef {
  readonly onClick: ButtonClickHandler;
  readonly conversationKey: string;
  readonly expiresAt: number;
}

export interface JsxButtonBatch {
  bind(props: ButtonProps): Segment;
  /** Publish callbacks immediately before transport; revoke them on definitive non-delivery. */
  activate(payloads: ReadonlySet<string>): () => void;
}

/** Plugin-incarnation-owned callbacks: survive unrelated plugin HMR; retired when owning plugin reloads. */
export class JsxButtonRegistry {
  readonly #bindings = new Map<string, ButtonBinding>();

  prepare(request: SendRequest, snapshot: RuntimeSnapshot): JsxButtonBatch {
    const pending = new Map<string, ButtonBinding>();
    const node = snapshot.tree.get(request.requester);
    const signal = request[operationEndpoint]?.signal;
    return {
      bind: (props) => {
        const { onClick, payload: manualPayload, children, label, id, ...options } = props;
        if (onClick !== undefined && typeof onClick !== 'function') throw new TypeError('Button onClick must be a function');
        if (onClick && manualPayload !== undefined) throw new TypeError('Button accepts onClick or payload, not both');
        if (!onClick && typeof manualPayload !== 'string') throw new TypeError('Button requires onClick or payload');
        const payload = onClick ? `${PREFIX}${randomUUID()}` : manualPayload!;
        if (onClick && !props.disabled) pending.set(payload, {
          onClick,
          requester: request.requester,
          snapshot,
          node,
          ...(signal ? { signal } : {}),
          conversationKey: conversationRefKey(request.conversation),
          expiresAt: 0,
        });
        return { type: 'keyboard', data: { rows: [[{
          ...options,
          id: id ?? randomUUID(),
          label: label ?? children,
          payload,
          ...(onClick ? { mode: 'callback' } : {}),
        }]] } };
      },
      activate: (payloads) => {
        const activated: string[] = [];
        this.#prune(snapshot);
        for (const [payload, binding] of pending) {
          if (!payloads.has(payload)) continue;
          this.#bindings.set(payload, { ...binding, expiresAt: Date.now() + BUTTON_TTL_MS });
          activated.push(payload);
        }
        pending.clear();
        return () => { for (const payload of activated) this.#bindings.delete(payload); };
      },
    };
  }

  async dispatch(message: Message, payload: string, snapshot: RuntimeSnapshot): Promise<boolean> {
    if (!isJsxButtonPayload(payload)) return false;
    this.#prune(snapshot);
    const binding = this.#bindings.get(payload);
    // Never invoke a retired closure. The reply uses this incoming operation's scope.
    if (!binding || !isPluginIncarnationAlive(binding, snapshot)) {
      if (binding) this.#bindings.delete(payload);
      await message.$reply(t(message.locale, 'expired'));
      return true;
    }
    if (binding.conversationKey !== conversationRefKey(message.conversation)) return true;
    const bound = bindOperationInput(message, binding.requester, snapshot);
    const content = await binding.onClick(bound);
    if (typeof content === 'number') await bound.$reply(jsx('text', { text: String(content) }));
    else if (content != null && typeof content !== 'boolean') await bound.$reply(content);
    return true;
  }

  #prune(currentSnapshot?: RuntimeSnapshot): void {
    const now = Date.now();
    for (const [payload, binding] of this.#bindings) {
      if (binding.expiresAt <= now || (currentSnapshot && !isPluginIncarnationAlive(binding, currentSnapshot))) {
        this.#bindings.delete(payload);
      }
    }
  }
}

export function collectButtonPayloads(payload: unknown): Set<string> {
  const result = new Set<string>();
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    if (isKeyboardSegment(item)) {
      for (const row of item.data.rows) for (const button of row) result.add(button.payload);
    }
  }
  return result;
}
