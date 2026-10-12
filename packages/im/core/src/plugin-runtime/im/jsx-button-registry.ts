import { randomUUID } from 'node:crypto';
import { jsx } from '@zhin.js/jsx';
import { conversationRefKey, type Segment } from '@zhin.js/im-contract';
import { bindOperationInput } from '@zhin.js/feature-kit';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ButtonProps, ButtonClickHandler } from '../../jsx/message-tags.js';
import type { Message, SendRequest } from './contracts.js';
import { isKeyboardSegment } from '../../built/interactive-segments/types.js';

const PREFIX = 'zhin:jsx:';

interface ButtonBinding {
  readonly onClick: ButtonClickHandler;
  readonly requester: SendRequest['requester'];
  readonly conversationKey: string;
}

export interface JsxButtonBatch {
  bind(props: ButtonProps): Segment;
  /** Publish only callbacks actually included in a confirmed outgoing message. */
  activate(payloads: ReadonlySet<string>): void;
}

/** Snapshot-owned callbacks: retired generations are unreachable and can be collected. */
export class JsxButtonRegistry {
  readonly #bindings = new WeakMap<RuntimeSnapshot, Map<string, ButtonBinding>>();

  prepare(request: SendRequest, snapshot: RuntimeSnapshot): JsxButtonBatch {
    const pending = new Map<string, ButtonBinding>();
    return {
      bind: (props) => {
        const { onClick, payload: manualPayload, children, label, id, ...options } = props;
        if (onClick !== undefined && typeof onClick !== 'function') throw new TypeError('Button onClick must be a function');
        if (onClick && manualPayload !== undefined) throw new TypeError('Button accepts onClick or payload, not both');
        if (!onClick && typeof manualPayload !== 'string') throw new TypeError('Button requires onClick or payload');
        const payload = onClick ? `${PREFIX}${randomUUID()}` : manualPayload!;
        if (onClick && !props.disabled) pending.set(payload, {
          onClick, requester: request.requester, conversationKey: conversationRefKey(request.conversation),
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
        let active = this.#bindings.get(snapshot);
        for (const [payload, binding] of pending) {
          if (!payloads.has(payload)) continue;
          if (!active) this.#bindings.set(snapshot, active = new Map());
          active.set(payload, binding);
        }
        pending.clear();
      },
    };
  }

  async dispatch(message: Message, payload: string, snapshot: RuntimeSnapshot): Promise<boolean> {
    if (!payload.startsWith(PREFIX)) return false;
    const binding = this.#bindings.get(snapshot)?.get(payload);
    // Consume stale, unknown and cross-conversation callbacks without invoking user code.
    if (!binding || binding.conversationKey !== conversationRefKey(message.conversation)) return true;
    const bound = bindOperationInput(message, binding.requester, snapshot);
    const content = await binding.onClick(bound);
    if (typeof content === 'number') await bound.$reply(jsx('text', { text: String(content) }));
    else if (content != null && typeof content !== 'boolean') await bound.$reply(content);
    return true;
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
