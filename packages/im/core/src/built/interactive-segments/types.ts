import type { MessageElement } from '../../types.js';

export const KEYBOARD_SEGMENT_TYPE = 'keyboard' as const;

export const ACTION_SEGMENT_TYPE = 'action' as const;

export type ButtonStyle = 'primary' | 'danger' | 'secondary';

/** callback：平台回调 action 入站；command：QQ 指令预填后文本入站 */
export type ButtonInteractionMode = 'callback' | 'command';

export interface ButtonCommandOptions {
  /** QQ action.enter — 仅单聊；预填后自动发送 */
  enter?: boolean;
  /** QQ action.reply — 预填时引用原消息 */
  reply?: boolean;
}

// 出站 canonical Segment 要求 `data: Record<string, unknown>`：type 别名（对象字面量
// 类型）自带隐式索引签名，interface 没有 —— 这几个 data 必须是 type 别名才能直接
// 流入 Plugin Runtime 的 SendContent。
export type ButtonData = {
  id: string;
  label: string;
  payload: string;
  disabled?: boolean;
  style?: ButtonStyle;
  /** 默认 callback */
  mode?: ButtonInteractionMode;
  command?: ButtonCommandOptions;
};
export type KeyboardFallback = {
  hint: string;
  map: Record<string, string>;
};
export type KeyboardSegmentData = {
  rows: ButtonData[][];
  fallback?: KeyboardFallback;
};
export type ActionSegmentData = {
  id: string;
  payload: string;
  sourceMessageId?: string;
};

export type InteractivePolicy = 'native' | 'text';

export const DEFAULT_INTERACTIVE_POLICY: InteractivePolicy = 'text';

export function isKeyboardSegment(item: unknown): item is MessageElement & {
  type: typeof KEYBOARD_SEGMENT_TYPE;
  data: KeyboardSegmentData;
} {
  if (!isRecord(item) || item.type !== KEYBOARD_SEGMENT_TYPE || !isRecord(item.data)) return false;
  const { rows, fallback } = item.data;
  return Array.isArray(rows) && rows.every(row => Array.isArray(row) && row.every(isButtonData))
    && (fallback === undefined || (isRecord(fallback) && typeof fallback.hint === 'string'
      && isRecord(fallback.map) && Object.values(fallback.map).every(value => typeof value === 'string')));
}

export function isActionSegment(item: unknown): item is MessageElement & {
  type: typeof ACTION_SEGMENT_TYPE;
  data: ActionSegmentData;
} {
  return isRecord(item) && item.type === ACTION_SEGMENT_TYPE && isRecord(item.data)
    && typeof item.data.id === 'string' && typeof item.data.payload === 'string'
    && (item.data.sourceMessageId === undefined || typeof item.data.sourceMessageId === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isButtonData(value: unknown): value is ButtonData {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string'
    && typeof value.payload === 'string'
    && (value.disabled === undefined || typeof value.disabled === 'boolean')
    && (value.style === undefined || value.style === 'primary' || value.style === 'danger' || value.style === 'secondary')
    && (value.mode === undefined || value.mode === 'callback' || value.mode === 'command')
    && (value.command === undefined || (isRecord(value.command)
      && (value.command.enter === undefined || typeof value.command.enter === 'boolean')
      && (value.command.reply === undefined || typeof value.command.reply === 'boolean')));
}
