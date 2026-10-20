/**
 * OneBot 系 keyboard extension — 对齐 OneBot 11 键盘消息 API 子集。
 */
import type { MessageElement } from '../../../types.js';
import type { AiOutboundExtensionDefinition, AiOutboundParseContext } from '../types.js';
import { KeyboardSegment } from '../../interactive-segments/keyboard-segment.js';
import type { ButtonData } from '../../interactive-segments/types.js';

const ONEBOT_KEYBOARD_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            payload: { type: 'string' },
            id: { type: 'string' },
          },
          required: ['label', 'payload'],
        },
      },
    },
  },
  required: ['rows'],
} as const;

function toKeyboardSegment(ext: unknown): MessageElement | null {
  if (!ext || typeof ext !== 'object') return null;
  const obj = ext as Record<string, unknown>;
  const rowsRaw = obj.rows;
  if (!Array.isArray(rowsRaw)) return null;
  const rows: ButtonData[][] = [];
  for (const row of rowsRaw) {
    if (!Array.isArray(row)) continue;
    const buttons: ButtonData[] = [];
    for (const btn of row) {
      if (!btn || typeof btn !== 'object') continue;
      const b = btn as Record<string, unknown>;
      const label = typeof b.label === 'string' ? b.label : '';
      const payload = typeof b.payload === 'string' ? b.payload : '';
      if (!label || !payload) continue;
      buttons.push({
        id: typeof b.id === 'string' ? b.id : payload,
        label,
        payload,
        disabled: b.disabled === true,
      });
    }
    if (buttons.length) rows.push(buttons);
  }
  if (!rows.length) return null;
  return new KeyboardSegment({ rows }).toElement();
}

export const ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION: AiOutboundExtensionDefinition = {
  key: 'onebot.keyboard',
  schema: ONEBOT_KEYBOARD_SCHEMA,
  examples: [
    '{"extensions":{"onebot.keyboard":{"rows":[[{"label":"确认","payload":"ok","id":"ok"}]]}}}',
  ],
  toMessageElements(ext: unknown, _ctx: AiOutboundParseContext) {
    const seg = toKeyboardSegment(ext);
    return seg ? [seg] : [];
  },
};
