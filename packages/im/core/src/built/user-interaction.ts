import type {
  UserInteractionContent,
  UserInteractionOption,
  UserInteractionRequest,
} from '@zhin.js/interaction';
import type { SendContent } from '../plugin-runtime/im/contracts.js';
import type { ButtonStyle } from './interactive-segments/types.js';

export interface UserInteractionAction {
  readonly label: string;
  readonly value: string;
  readonly style?: ButtonStyle;
}

export interface UserInteractionView extends UserInteractionContent {
  readonly actions?: readonly UserInteractionAction[];
}

export interface UserInteractionProgress extends UserInteractionContent {
  readonly index: number;
  readonly total: number;
}

export type UserInteractionParseResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; message: string }>;

/** Fail early for interaction definitions that could never produce an unambiguous answer. */
export function assertUserInteractionRequest(request: UserInteractionRequest): void {
  if (!request.title.trim()) throw new TypeError('User interaction title must not be empty');
  if (request.timeout !== undefined && (!Number.isFinite(request.timeout) || request.timeout <= 0)) {
    throw new RangeError('User interaction timeout must be a positive finite number');
  }
  if (request.type === 'text' && !validRange(request.minLength, request.maxLength)) {
    throw new RangeError('User interaction text length range is invalid');
  }
  if (request.type === 'number' && !validBounds(request.min, request.max)) {
    throw new RangeError('User interaction number range is invalid');
  }
  if (request.type === 'select' || request.type === 'multiselect') {
    if (request.options.length === 0) throw new TypeError('User interaction options must not be empty');
    const labels = new Set<string>();
    for (const option of request.options) {
      const label = option.label.trim().toLocaleLowerCase();
      if (!label) throw new TypeError('User interaction option label must not be empty');
      if (labels.has(label)) throw new TypeError(`Duplicate user interaction option label: ${option.label}`);
      labels.add(label);
    }
  }
  if (request.type === 'multiselect') {
    if (request.separator === '') throw new TypeError('User interaction separator must not be empty');
    if (!validRange(request.minSelections, request.maxSelections)) {
      throw new RangeError('User interaction selection range is invalid');
    }
  }
  if (request.type === 'list') {
    if (request.separator === '') throw new TypeError('User interaction separator must not be empty');
    if (!validRange(request.minItems, request.maxItems)) {
      throw new RangeError('User interaction list length range is invalid');
    }
  }
}

/** Project semantic content into canonical Markdown + keyboard segments. */
export function renderUserInteraction(view: UserInteractionView): SendContent {
  const markdown = [
    `### ${view.title}`,
    view.description?.trim(),
    view.tip?.trim() ? quoteTip(view.tip.trim()) : undefined,
  ].filter((part): part is string => !!part).join('\n\n');
  const actions = view.actions ?? [];
  if (actions.length === 0) {
    return [{ type: 'markdown', data: { content: markdown } }];
  }
  const buttons = actions.map((action, index) => ({
    id: `interaction-${index + 1}`,
    label: action.label,
    payload: action.value,
    ...(action.style ? { style: action.style } : {}),
    mode: 'command' as const,
    command: { enter: true, reply: false },
  }));
  return [
    { type: 'markdown', data: { content: markdown } },
    {
      type: 'keyboard',
      data: {
        rows: chunk(buttons, 5),
        fallback: {
          hint: '也可以直接回复对应内容。',
          map: Object.fromEntries(actions.map((action, index) => [String(index + 1), action.value])),
        },
      },
    },
  ];
}

/** Derive presentation and controls from one discriminated request. */
export function projectUserInteraction(
  request: UserInteractionRequest,
  progress?: UserInteractionProgress,
): UserInteractionView {
  const instruction = instructionFor(request);
  const optionList = request.type === 'select' || request.type === 'multiselect'
    ? renderOptions(request.options)
    : undefined;
  const optionsHaveDescriptions = request.type === 'select' || request.type === 'multiselect'
    ? request.options.some((option) => !!option.description)
    : false;
  const actions = actionsFor(request);
  const stepDescription = [
    progress ? `**${progress.index}/${progress.total} · ${request.title}**` : undefined,
    request.description,
    optionList && (!actions || optionsHaveDescriptions) ? optionList : undefined,
  ].filter((part): part is string => !!part).join('\n\n');
  return Object.freeze({
    title: progress?.title ?? request.title,
    description: progress
      ? [progress.description, stepDescription].filter(Boolean).join('\n\n')
      : stepDescription || undefined,
    tip: [request.tip, instruction, progress?.tip].filter(Boolean).join('\n'),
    ...(actions ? { actions: Object.freeze(actions) } : {}),
  });
}

/** Parse and validate one user reply without transport knowledge. */
export function parseUserInteractionAnswer(
  request: UserInteractionRequest,
  rawInput: string,
): UserInteractionParseResult {
  const raw = rawInput.trim();
  switch (request.type) {
    case 'text': {
      if (raw.length < (request.minLength ?? 0)) return invalid(`请至少输入 ${request.minLength} 个字符`);
      if (request.maxLength !== undefined && raw.length > request.maxLength) {
        return invalid(`请不要超过 ${request.maxLength} 个字符`);
      }
      if (request.pattern) {
        request.pattern.lastIndex = 0;
        if (!request.pattern.test(raw)) return invalid('输入格式不正确');
      }
      return valid(raw);
    }
    case 'number': {
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) return invalid('请输入有效数字');
      if (request.integer && !Number.isInteger(value)) return invalid('请输入整数');
      if (request.min !== undefined && value < request.min) return invalid(`请输入不小于 ${request.min} 的数字`);
      if (request.max !== undefined && value > request.max) return invalid(`请输入不大于 ${request.max} 的数字`);
      return valid(value);
    }
    case 'confirm': {
      const normalized = raw.toLocaleLowerCase();
      const confirmLabel = request.confirmLabel?.trim().toLocaleLowerCase();
      const cancelLabel = request.cancelLabel?.trim().toLocaleLowerCase();
      if (CONFIRM_VALUES.has(normalized) || (confirmLabel && normalized === confirmLabel)) return valid(true);
      if (CANCEL_VALUES.has(normalized) || (cancelLabel && normalized === cancelLabel)) return valid(false);
      return invalid('请选择确认或取消');
    }
    case 'select': {
      const option = resolveOption(request.options, raw);
      return option ? valid(option.value) : invalid('请选择一个有效选项');
    }
    case 'multiselect': {
      const separator = request.separator ?? ',';
      const tokens = raw.split(separator).map((token) => token.trim()).filter(Boolean);
      const selected = uniqueOptions(tokens.map((token) => resolveOption(request.options, token)));
      if (selected.length !== tokens.length) return invalid('多选中包含无效选项');
      if (selected.length < (request.minSelections ?? 0)) return invalid(`请至少选择 ${request.minSelections} 项`);
      if (request.maxSelections !== undefined && selected.length > request.maxSelections) {
        return invalid(`请最多选择 ${request.maxSelections} 项`);
      }
      return valid(Object.freeze(selected.map((option) => option.value)));
    }
    case 'list': {
      const separator = request.separator ?? ',';
      const tokens = raw.split(separator).map((token) => token.trim()).filter(Boolean);
      if (tokens.length < (request.minItems ?? 0)) return invalid(`请至少输入 ${request.minItems} 项`);
      if (request.maxItems !== undefined && tokens.length > request.maxItems) return invalid(`请最多输入 ${request.maxItems} 项`);
      if (request.valueType === 'number') {
        const values = tokens.map(Number);
        return values.every(Number.isFinite) ? valid(Object.freeze(values)) : invalid('列表中包含无效数字');
      }
      if (request.valueType === 'boolean') {
        const values = tokens.map(parseBoolean);
        return values.every((value) => value !== undefined)
          ? valid(Object.freeze(values as boolean[]))
          : invalid('布尔列表只接受 true/false、yes/no 或 是/否');
      }
      return valid(Object.freeze(tokens));
    }
  }
}

function actionsFor(request: UserInteractionRequest): UserInteractionAction[] | undefined {
  if (request.type === 'confirm') {
    return [
      { label: request.confirmLabel ?? '确认', value: 'yes', style: 'primary' },
      { label: request.cancelLabel ?? '取消', value: 'no', style: 'danger' },
    ];
  }
  if (request.type === 'select' && request.options.length <= 10) {
    return request.options.map((option, index) => ({ label: option.label, value: String(index + 1), style: 'secondary' }));
  }
  return undefined;
}

function instructionFor(request: UserInteractionRequest): string | undefined {
  switch (request.type) {
    case 'confirm': return '请选择确认或取消。';
    case 'select': return '可以点击按钮，或回复序号/选项名称。';
    case 'multiselect': return `回复序号或选项名称，多项用“${request.separator ?? ','}”分隔。`;
    case 'list': return `多项用“${request.separator ?? ','}”分隔。`;
    default: return undefined;
  }
}

function renderOptions(options: readonly UserInteractionOption[]): string {
  return options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`).join('\n');
}

function resolveOption<V>(options: readonly UserInteractionOption<V>[], raw: string): UserInteractionOption<V> | undefined {
  const index = Number(raw);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1];
  const normalized = raw.toLocaleLowerCase();
  return options.find((option) => option.label.trim().toLocaleLowerCase() === normalized);
}

function uniqueOptions<V>(options: readonly (UserInteractionOption<V> | undefined)[]): UserInteractionOption<V>[] {
  const result: UserInteractionOption<V>[] = [];
  for (const option of options) if (option && !result.includes(option)) result.push(option);
  return result;
}

function parseBoolean(raw: string): boolean | undefined {
  const normalized = raw.toLocaleLowerCase();
  if (CONFIRM_VALUES.has(normalized)) return true;
  if (CANCEL_VALUES.has(normalized)) return false;
  return undefined;
}

function quoteTip(tip: string): string {
  return tip.split('\n').map((line) => `> 💡 ${line}`).join('\n');
}

function valid(value: unknown): UserInteractionParseResult {
  return Object.freeze({ ok: true, value });
}

function invalid(message: string): UserInteractionParseResult {
  return Object.freeze({ ok: false, message });
}

function validRange(minimum?: number, maximum?: number): boolean {
  return (minimum === undefined || (Number.isFinite(minimum) && minimum >= 0))
    && (maximum === undefined || (Number.isFinite(maximum) && maximum >= 0))
    && (minimum === undefined || maximum === undefined || minimum <= maximum);
}

function validBounds(minimum?: number, maximum?: number): boolean {
  return (minimum === undefined || Number.isFinite(minimum))
    && (maximum === undefined || Number.isFinite(maximum))
    && (minimum === undefined || maximum === undefined || minimum <= maximum);
}

const CONFIRM_VALUES = new Set(['1', 'y', 'yes', 'true', '是', '确认', '同意']);
const CANCEL_VALUES = new Set(['2', 'n', 'no', 'false', '否', '取消', '拒绝']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}
