import type { OutputElement, Usage } from '@zhin.js/ai';
import {
  formatCompactLog,
  formatCompactUsage,
  formatLogKvTable,
  truncatePreview,
  wrapDisplayText,
  type LogKvRow,
} from '@zhin.js/logger';
import chalk from 'chalk';

export type { HostTurnPath as ZhinAgentTurnPath, HostTurnMetrics as ZhinAgentTurnMetrics } from '../internal/host-types.js';
import type { HostTurnMetrics as ZhinAgentTurnMetrics } from '../internal/host-types.js';

const HANDLER_VALUE_WIDTH = 54;
const PREVIEW_MAX_CHARS = 320;

export function addUsage(target: Usage, source?: Usage): void {
  if (!source) return;
  target.prompt_tokens += source.prompt_tokens;
  target.completion_tokens += source.completion_tokens;
  target.total_tokens += source.total_tokens;
}

export const EMPTY_USAGE: Usage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

export interface AiHandlerTurnLogContext {
  userInput?: string;
  thinking?: string;
  output?: string;
  path?: string;
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function previewToKvRows(label: string, raw: string | undefined, maxWidth: number): LogKvRow[] {
  const normalized = normalizePreviewText(raw ?? '');
  if (!normalized) {
    return [{ label, value: chalk.dim('·') }];
  }
  const clipped = truncatePreview(normalized, PREVIEW_MAX_CHARS);
  const lines = wrapDisplayText(clipped, maxWidth);
  return lines.map((line, index) => ({
    label: index === 0 ? label : '',
    value: line,
  }));
}

function buildModeLine(metrics: ZhinAgentTurnMetrics): string {
  const parts = [`mode: ${metrics.path}`];
  if (metrics.iterations != null) parts.push(`iter: ${metrics.iterations}`);
  if (metrics.model) parts.push(`model: ${metrics.model}`);
  return parts.join(' · ');
}

/** AI Handler 层统一汇总日志（框线表格） */
export function formatAiHandlerTurnTable(
  metrics: ZhinAgentTurnMetrics,
  totalMs: number,
  context: AiHandlerTurnLogContext = {},
): string {
  const userInput = context.userInput ?? metrics.userInput;
  const thinking = context.thinking ?? metrics.thinking;
  const output = context.output ?? metrics.output;

  const rows: LogKvRow[] = [
    { label: '耗时', value: `${Math.round(totalMs)} ms` },
    { label: 'Token', value: formatCompactUsage(metrics.usage, metrics.subagentUsage) },
    { label: '模式', value: buildModeLine(metrics) },
  ];

  const contentRows: LogKvRow[] = [
    ...previewToKvRows('用户输入', userInput, HANDLER_VALUE_WIDTH),
    ...previewToKvRows('思考', thinking, HANDLER_VALUE_WIDTH),
    ...previewToKvRows('输出', output, HANDLER_VALUE_WIDTH),
  ];

  const sectionBreaks: number[] = [rows.length - 1];
  rows.push(...contentRows);

  return formatLogKvTable(rows, {
    title: chalk.bold.cyan(`AI Handler · ${Math.round(totalMs)} ms`),
    sectionBreaks,
    maxValueWidth: HANDLER_VALUE_WIDTH,
  });
}

/** @deprecated 使用 formatAiHandlerTurnTable */
export function formatAiHandlerCompleteLog(metrics: ZhinAgentTurnMetrics, totalMs: number): string {
  return formatAiHandlerTurnTable(metrics, totalMs);
}

/** OutputElement[] → 日志预览文本 */
export function formatOutputElementsPreview(elements: OutputElement[]): string | undefined {
  const text = elements.map((el) => {
    if (el.type === 'text') return el.content || '';
    if (el.type === 'image') return `<image url="${el.url}"/>`;
    return '';
  }).join('\n').trim();
  return text || undefined;
}

/** @deprecated 使用 formatCompactUsage from @zhin.js/logger */
export function formatZhinAgentTurnUsage(usage: Usage, subagentUsage?: Usage): string {
  return formatCompactUsage(usage, subagentUsage);
}

export function formatAiHandlerFallbackLog(totalMs: number, path?: string): string {
  return formatCompactLog('AI Handler', {
    total_ms: Math.round(totalMs),
    ...(path ? { path } : { usage: 'n/a' }),
  });
}
