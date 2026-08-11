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

export type InteractiveHandler = (
  message: import('../../message.js').Message<any>,
) => Promise<boolean> | boolean;

export interface RegisteredInteractiveHandler {
  prefix: string;
  handler: InteractiveHandler;
}

export function isKeyboardSegment(item: MessageElement): item is MessageElement & {
  type: typeof KEYBOARD_SEGMENT_TYPE;
  data: KeyboardSegmentData;
} {
  return item != null && typeof item === 'object' && 'type' in item && item.type === KEYBOARD_SEGMENT_TYPE;
}

export function isActionSegment(item: MessageElement): item is MessageElement & {
  type: typeof ACTION_SEGMENT_TYPE;
  data: ActionSegmentData;
} {
  return item != null && typeof item === 'object' && 'type' in item && item.type === ACTION_SEGMENT_TYPE;
}
