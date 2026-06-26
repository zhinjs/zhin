import type { ButtonData } from './types.js';

/** 键盘布局单元：`segment.button()` 产物，仅用于组装 `segment.keyboard()` */
export class ButtonSpec {
  constructor(public readonly data: ButtonData) {}
}

export type KeyboardRowInput = Array<ButtonSpec | ButtonData>;

export function isButtonLike(value: unknown): value is ButtonSpec | ButtonData {
  if (value == null || typeof value !== 'object') return false;
  if (value instanceof ButtonSpec) return true;
  const v = value as ButtonData;
  return typeof v.id === 'string' && typeof v.label === 'string' && typeof v.payload === 'string';
}

export function normalizeButton(btn: ButtonSpec | ButtonData): ButtonData {
  return btn instanceof ButtonSpec ? btn.data : btn;
}

export function normalizeKeyboardRows(rows: KeyboardRowInput[]): ButtonData[][] {
  return rows.map((row) => row.map(normalizeButton));
}
