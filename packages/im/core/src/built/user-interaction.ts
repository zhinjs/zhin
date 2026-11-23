import type { Locale } from '@zhin.js/plugin-runtime';
import { interactionMessages as t } from './interaction-messages.js';
import { isApprovalApproveWord, isApprovalDenyWord, isCancelWord, isConfirmWord, normalizeReplyWord } from './confirm-words.js';
import type {
  UserInteractionContent,
  UserInteractionOption,
  UserInteractionPurpose,
  UserInteractionRequest,
} from '@zhin.js/im-contract';
import type { SendContent } from '../plugin-runtime/im/contracts.js';
import type { ButtonStyle } from './interactive-segments/types.js';

export interface UserInteractionAction {
  readonly label: string;
  readonly value: string;
  readonly style?: ButtonStyle;
}

export interface UserInteractionView extends UserInteractionContent {
  readonly actions?: readonly UserInteractionAction[];
  /** Copied from the request; rendered as keyboard `data.purpose` so surfaces can label approvals. */
  readonly purpose?: UserInteractionPurpose;
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
  if (request.answeredBy !== undefined && request.answeredBy !== 'target' && request.answeredBy !== 'anyone') {
    throw new TypeError("User interaction answeredBy must be 'target' or 'anyone'");
  }
  if (request.type === 'text' && !validRange(request.minLength, request.maxLength)) {
    throw new RangeError('User interaction text length range is invalid');
  }
  if (request.type === 'number' && !validBounds(request.min, request.max)) {
    throw new RangeError('User interaction number range is invalid');
  }
  if (request.type === 'select' || request.type === 'multiselect') {
    if (request.options.length === 0) throw new TypeError('User interaction options must not be empty');
    for (const option of request.options) {
      const label = option.label.trim().toLocaleLowerCase();
      if (!label) throw new TypeError('User interaction option label must not be empty');
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
export function renderUserInteraction(
  view: UserInteractionView,
  actionPayload: (value: string, index: number) => string = (value) => value,
  locale: Locale = 'zh-CN',
): SendContent {
  const markdown = [
    `### ${view.title}`,
    view.description?.trim(),
    view.tip?.trim() ? quoteTip(view.tip.trim()) : undefined,
  ].filter((part): part is string => !!part).join('\n\n');
  const actions = view.actions ?? [];
  const hasInlineOptionList = actions.length > 0
    && actions.every((action, index) => view.description?.includes(`${index + 1}. ${action.label}`));
  if (actions.length === 0 || hasInlineOptionList) {
    return [{ type: 'markdown', data: { content: markdown } }];
  }
  const buttons = actions.map((action, index) => ({
    id: `interaction-${index + 1}`,
    label: action.label,
    payload: actionPayload(action.value, index),
    ...(action.style ? { style: action.style } : {}),
    mode: 'callback' as const,
  }));
  return [
    { type: 'markdown', data: { content: markdown } },
    {
      type: 'keyboard',
      data: {
        ...(view.purpose ? { purpose: view.purpose } : {}),
        rows: chunk(buttons, 5),
        fallback: {
          hint: t(locale, 'fallback'),
          map: Object.fromEntries(buttons.map((button, index) => [String(index + 1), button.payload])),
        },
      },
    },
  ];
}

/** Derive presentation and controls from one discriminated request. */
export function projectUserInteraction(
  request: UserInteractionRequest,
  progress?: UserInteractionProgress,
  locale: Locale = 'zh-CN',
): UserInteractionView {
  const instruction = instructionFor(request, locale);
  const optionList = request.type === 'select' || request.type === 'multiselect'
    ? renderOptions(request.options)
    : undefined;
  const optionsHaveDescriptions = request.type === 'select' || request.type === 'multiselect'
    ? request.options.some((option) => !!option.description)
    : false;
  const actions = actionsFor(request, locale);
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
    ...(request.purpose ? { purpose: request.purpose } : {}),
  });
}

/** Parse and validate one user reply without transport knowledge. */
export function parseUserInteractionAnswer(
  request: UserInteractionRequest,
  rawInput: string,
  locale: Locale = 'zh-CN',
  action = false,
): UserInteractionParseResult {
  const raw = rawInput.trim();
  switch (request.type) {
    case 'text': {
      if (raw.length < (request.minLength ?? 0)) return invalid(t(locale, 'minLength', { count: request.minLength! }));
      if (request.maxLength !== undefined && raw.length > request.maxLength) {
        return invalid(t(locale, 'maxLength', { count: request.maxLength }));
      }
      if (request.pattern) {
        request.pattern.lastIndex = 0;
        if (!request.pattern.test(raw)) return invalid(t(locale, 'pattern'));
      }
      return valid(raw);
    }
    case 'number': {
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) return invalid(t(locale, 'number'));
      if (request.integer && !Number.isInteger(value)) return invalid(t(locale, 'integer'));
      if (request.min !== undefined && value < request.min) return invalid(t(locale, 'min', { count: request.min }));
      if (request.max !== undefined && value > request.max) return invalid(t(locale, 'max', { count: request.max }));
      return valid(value);
    }
    case 'confirm': {
      const normalized = raw.toLowerCase();
      if (action && normalized === 'yes') return valid(true);
      if (action && normalized === 'no') return valid(false);
      // #1250 第 74 批：确认 / 取消词中英文都认，不分提问语言；`1` / `2` 是本题两个选项的序号。
      const word = normalizeReplyWord(raw);
      const confirmLabel = request.confirmLabel ? normalizeReplyWord(request.confirmLabel) : '';
      const cancelLabel = request.cancelLabel ? normalizeReplyWord(request.cancelLabel) : '';
      if (word === '1' || isConfirmWord(raw, YES_NO) || (confirmLabel && word === confirmLabel)) return valid(true);
      if (word === '2' || isCancelWord(raw, YES_NO) || (cancelLabel && word === cancelLabel)) return valid(false);
      return invalid(t(locale, 'confirmOrCancel'));
    }
    case 'select': {
      const option = resolveOption(request.options, raw, request.purpose === 'approval');
      return option ? valid(option.value) : invalid(t(locale, 'select'));
    }
    case 'multiselect': {
      const separator = request.separator ?? ',';
      const tokens = raw.split(separator).map((token) => token.trim()).filter(Boolean);
      const selected = uniqueOptions(tokens.map((token) => resolveOption(request.options, token)));
      if (selected.length !== tokens.length) return invalid(t(locale, 'invalidSelection'));
      if (selected.length < (request.minSelections ?? 0)) return invalid(t(locale, 'minSelections', { count: request.minSelections! }));
      if (request.maxSelections !== undefined && selected.length > request.maxSelections) {
        return invalid(t(locale, 'maxSelections', { count: request.maxSelections }));
      }
      return valid(Object.freeze(selected.map((option) => option.value)));
    }
    case 'list': {
      const separator = request.separator ?? ',';
      const tokens = raw.split(separator).map((token) => token.trim()).filter(Boolean);
      if (tokens.length < (request.minItems ?? 0)) return invalid(t(locale, 'minItems', { count: request.minItems! }));
      if (request.maxItems !== undefined && tokens.length > request.maxItems) return invalid(t(locale, 'maxItems', { count: request.maxItems }));
      if (request.valueType === 'number') {
        const values = tokens.map(Number);
        return values.every(Number.isFinite) ? valid(Object.freeze(values)) : invalid(t(locale, 'invalidNumbers'));
      }
      if (request.valueType === 'boolean') {
        const values = tokens.map(value => parseBoolean(value));
        return values.every((value) => value !== undefined)
          ? valid(Object.freeze(values as boolean[]))
          : invalid(t(locale, 'invalidBooleans'));
      }
      return valid(Object.freeze(tokens));
    }
  }
}

function actionsFor(request: UserInteractionRequest, locale: Locale): UserInteractionAction[] | undefined {
  if (request.type === 'confirm') {
    return [
      { label: request.confirmLabel ?? t(locale, 'confirm'), value: 'yes', style: 'primary' },
      { label: request.cancelLabel ?? t(locale, 'cancel'), value: 'no', style: 'danger' },
    ];
  }
  // Every option becomes a button; the endpoint's capability profile decides how many it shows
  // natively (`segments.interactiveLimits.maxButtons`) and text-only endpoints number them (#1250).
  if (request.type === 'select') {
    return request.options.map((option, index) => ({ label: option.label, value: String(index + 1), style: 'secondary' }));
  }
  return undefined;
}

function instructionFor(request: UserInteractionRequest, locale: Locale): string | undefined {
  switch (request.type) {
    case 'confirm': return t(locale, 'confirmation');
    case 'number': return t(locale, 'numberInstruction');
    case 'select': return t(locale, 'selection');
    case 'multiselect': return t(locale, 'multiple', { separator: request.separator ?? ',' });
    case 'list': return t(locale, 'list', { separator: request.separator ?? ',' });
    default: return undefined;
  }
}

function renderOptions(options: readonly UserInteractionOption[]): string {
  return options.map((option, index) => {
    const aliases = option.aliases?.length ? `（${option.aliases.join(' / ')}）` : '';
    const description = option.description ? ` — ${option.description}` : '';
    return `${index + 1}. ${option.label}${aliases}${description}`;
  }).join('\n');
}

function resolveOption<V>(
  options: readonly UserInteractionOption<V>[],
  raw: string,
  approval = false,
): UserInteractionOption<V> | undefined {
  const index = Number(raw);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1];
  const normalized = normalizeReplyWord(raw);
  const matches = (candidate: string) => normalizeReplyWord(candidate) === normalized;
  return options.find((option) => matches(option.label))
    ?? options.find((option) => option.aliases?.some(matches))
    ?? (approval ? approvalWordOption(options, raw) : undefined);
}

/**
 * #1250 第 74 批（审查 M1/M2）：只在审批（`purpose: 'approval'`）里，一个以明确批准词为名称 / 别名的
 * 选项接受所有明确批准词（`确认` / `同意` / `批准` / `confirm` / `approve` / `yes`），以明确拒绝词为
 * 名称 / 别名的选项接受所有明确拒绝词（`拒绝` / `否` / `no` / `deny` / `reject`），中英文都算；
 * `好` / `是` / `ok` / `y` / `确定` 这类随口应答不算批准。只有恰好一个选项属于该类时才匹配。
 * 普通 select / multiselect 只按名称、别名与序号匹配，不做同类词扩展。
 */
function approvalWordOption<V>(options: readonly UserInteractionOption<V>[], raw: string): UserInteractionOption<V> | undefined {
  const test = isApprovalApproveWord(raw) ? isApprovalApproveWord : isApprovalDenyWord(raw) ? isApprovalDenyWord : undefined;
  if (!test) return undefined;
  const candidates = options.filter((option) => test(option.label) || option.aliases?.some(test));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueOptions<V>(options: readonly (UserInteractionOption<V> | undefined)[]): UserInteractionOption<V>[] {
  const result: UserInteractionOption<V>[] = [];
  for (const option of options) if (option && !result.includes(option)) result.push(option);
  return result;
}

function parseBoolean(raw: string): boolean | undefined {
  const word = normalizeReplyWord(raw);
  if (word === '1' || isConfirmWord(raw, YES_NO)) return true;
  if (word === '2' || isCancelWord(raw, YES_NO)) return false;
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

/** confirm 提问与布尔列表都是是非问答：`是` / `否` / `no` 等是非答语也算（见 `confirm-words.ts`）。 */
const YES_NO = Object.freeze({ yesNo: true });

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}
