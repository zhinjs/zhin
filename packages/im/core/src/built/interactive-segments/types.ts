import type { MessageElement } from '../../types.js';

export const KEYBOARD_SEGMENT_TYPE = 'keyboard' as const;
/** @deprecated 使用 {@link KEYBOARD_SEGMENT_TYPE} */
export const INTERACTIVE_SEGMENT_TYPE = KEYBOARD_SEGMENT_TYPE;

export const ACTION_SEGMENT_TYPE = 'action' as const;

export type ButtonStyle = 'primary' | 'danger' | 'secondary';
/** @deprecated 使用 {@link ButtonStyle} */
export type InteractiveButtonStyle = ButtonStyle;

/** callback：平台回调 action 入站；command：QQ 指令预填后文本入站 */
export type ButtonInteractionMode = 'callback' | 'command';

export interface ButtonCommandOptions {
  /** QQ action.enter — 仅单聊；预填后自动发送 */
  enter?: boolean;
  /** QQ action.reply — 预填时引用原消息 */
  reply?: boolean;
}

export interface ButtonData {
  id: string;
  label: string;
  payload: string;
  disabled?: boolean;
  style?: ButtonStyle;
  /** 默认 callback */
  mode?: ButtonInteractionMode;
  command?: ButtonCommandOptions;
}
/** @deprecated 使用 {@link ButtonData} */
export type InteractiveButton = ButtonData;

export interface KeyboardFallback {
  hint: string;
  map: Record<string, string>;
}
/** @deprecated 使用 {@link KeyboardFallback} */
export type InteractiveFallback = KeyboardFallback;

export interface KeyboardSegmentData {
  rows: ButtonData[][];
  fallback?: KeyboardFallback;
}
/** @deprecated 使用 {@link KeyboardSegmentData} */
export type InteractiveSegmentData = KeyboardSegmentData;

export interface ActionSegmentData {
  id: string;
  payload: string;
  sourceMessageId?: string;
}

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

/** @deprecated 使用 {@link isKeyboardSegment} */
export const isInteractiveSegment = isKeyboardSegment;

export function isActionSegment(item: MessageElement): item is MessageElement & {
  type: typeof ACTION_SEGMENT_TYPE;
  data: ActionSegmentData;
} {
  return item != null && typeof item === 'object' && 'type' in item && item.type === ACTION_SEGMENT_TYPE;
}
