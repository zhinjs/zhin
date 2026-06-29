/**
 * 通用网格按钮键盘构建器
 * 支持井字棋（3×3）、五子棋（15×15）、四子棋（7×6）等
 */
import { segment, type SendContent } from 'zhin.js';
import type { ChoiceOption } from './choice-keyboard.js';
import { buildChoiceFallbackMap } from './choice-keyboard.js';
import { applyInteractionProfile } from './interaction-profiles.js';

export interface GridCell<T = unknown> {
  /** 单元格状态（游戏自定义，如 0=空, 1=X, 2=O） */
  state: T;
  /** 按钮显示文本 */
  label: string;
  /** 是否禁用（已落子或终局） */
  disabled: boolean;
  /** 高亮（胜利连线等） */
  highlight?: boolean;
}

export interface GridKeyboardOptions<T = unknown> {
  /** 游戏前缀（如 'ttt', 'gomoku', 'c4'） */
  gamePrefix: string;
  /** 会话 ID */
  sessionId: string;
  /** 行数 */
  rows: number;
  /** 列数 */
  cols: number;
  /** 单元格数据，按行优先 [row * cols + col] */
  cells: GridCell<T>[];
  /** 状态行文本 */
  statusLine: string;
  /** 是否终局（全部按钮禁用） */
  terminal?: boolean;
  /** 省略 ASCII 文本棋盘（QQ 等平台） */
  omitAsciiBoard?: boolean;
  /** ASCII 棋盘渲染器（可选，省略则不渲染 ASCII） */
  renderAscii?: (cells: GridCell<T>[], rows: number, cols: number, highlight?: number[]) => string;
  /** 高亮的单元格索引（胜利连线等） */
  highlight?: number[];
  /** fallback 提示文本 */
  fallbackHint?: string;
  /** 终局时在棋盘下方追加的选项（如「再来一局」，不受 terminal 禁用） */
  postChoices?: ChoiceOption[];
  /** postChoices 使用的 profile，默认 terminal */
  postChoicesProfile?: 'terminal';
  /** terminal 私聊 auto-enter */
  channelType?: string;
}

/**
 * 构建 fallback 数字映射（仅可落子的格子）
 */
export function buildGridFallbackMap(
  gamePrefix: string,
  sessionId: string,
  cells: GridCell[],
): Record<string, string> {
  const map: Record<string, string> = {};
  let n = 1;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]!.disabled) {
      map[String(n)] = `${gamePrefix}:${sessionId}:${i}`;
      n++;
    }
  }
  return map;
}

/**
 * 构建网格按钮键盘消息内容
 */
export function buildGridKeyboard<T>(options: GridKeyboardOptions<T>): SendContent {
  const {
    gamePrefix,
    sessionId,
    rows,
    cols,
    cells,
    statusLine,
    terminal,
    omitAsciiBoard,
    renderAscii,
    highlight,
    fallbackHint,
    postChoices,
    postChoicesProfile = 'terminal',
    channelType,
  } = options;

  const buttonRows: ReturnType<typeof segment.button>[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: ReturnType<typeof segment.button>[] = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cell = cells[i]!;
      row.push(
        segment.button({
          id: `c${i}`,
          label: cell.label,
          payload: `${gamePrefix}:${sessionId}:${i}`,
          disabled: terminal || cell.disabled,
          style: cell.highlight ? 'primary' : 'secondary',
        }),
      );
    }
    buttonRows.push(row);
  }

  const fallback = buildGridFallbackMap(gamePrefix, sessionId, cells);

  const textLines = [statusLine];
  if (!omitAsciiBoard && renderAscii) {
    textLines.push('', renderAscii(cells, rows, cols, highlight));
  }

  if (postChoices?.length) {
    buttonRows.push(
      postChoices.map((choice) => {
        const base = segment.button({
          id: choice.id,
          label: choice.label,
          payload: `${gamePrefix}:${sessionId}:${choice.id}`,
          disabled: choice.disabled ?? false,
          style: choice.style ?? 'primary',
        });
        return segment.button(
          applyInteractionProfile(base.data, {
            profile: postChoicesProfile,
            channelType,
          }),
        );
      }),
    );
    Object.assign(fallback, buildChoiceFallbackMap(gamePrefix, sessionId, postChoices));
  }

  const parts = [
    segment.text(textLines.join('\n')),
    segment.keyboard(buttonRows, {
      fallback: fallbackHint || Object.keys(fallback).length > 0
        ? {
            hint: fallbackHint ?? '回复数字选择',
            map: fallback,
          }
        : undefined,
    }).toElement(),
  ];

  return parts;
}

/**
 * 解析网格 payload：`{prefix}:{sessionId}:{cellIndex}`
 */
export function parseGridPayload(
  payload: string,
  expectedPrefix?: string,
): { prefix: string; sessionId: string; cell: number } | null {
  const m = /^([a-z0-9_]+):([^:]+):(\d+)$/i.exec(payload);
  if (!m) return null;
  const prefix = m[1]!;
  if (expectedPrefix && prefix !== expectedPrefix) return null;
  const cell = Number(m[3]);
  if (!Number.isInteger(cell) || cell < 0) return null;
  return { prefix, sessionId: m[2]!, cell };
}

/**
 * 解析按钮 ID 格式：`c{cellIndex}`（QQ 等平台 action 可能只回传 button_id）
 */
export function parseCellButtonId(value: string): number | null {
  const m = /^c(\d+)$/.exec(value);
  if (!m) return null;
  const cell = Number(m[1]);
  if (!Number.isInteger(cell) || cell < 0) return null;
  return cell;
}
