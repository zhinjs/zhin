/**
 * 分节面板 — 启动摘要等场景的结构化多行输出（可含 chalk 着色）。
 */
import chalk from 'chalk';
import { displayWidth, padDisplayEnd } from './terminal-width.js';

export interface LogPanelLine {
  label?: string;
  value: string;
}

export interface FormatLogPanelOptions {
  width?: number;
  labelWidth?: number;
}

const DEFAULT_WIDTH = 72;
const DEFAULT_LABEL_WIDTH = 8;

export function formatLogPanel(
  title: string,
  lines: LogPanelLine[],
  options: FormatLogPanelOptions = {},
): string {
  const width = options.width ?? DEFAULT_WIDTH;
  const labelWidth = options.labelWidth ?? DEFAULT_LABEL_WIDTH;
  const blocks: string[] = [];

  if (title) {
    const titleDecorated = chalk.bold.cyan(` ${title} `);
    const titleW = displayWidth(title) + 2;
    const dashTotal = Math.max(0, width - titleW);
    const dashLeft = Math.floor(dashTotal / 2);
    const dashRight = dashTotal - dashLeft;
    blocks.push(
      chalk.dim('═'.repeat(dashLeft)) + titleDecorated + chalk.dim('═'.repeat(dashRight)),
    );
  }

  for (const line of lines) {
    if (!line.label) {
      blocks.push(`  ${chalk.white(line.value)}`);
      continue;
    }
    const label = chalk.dim(padDisplayEnd(line.label, labelWidth));
    blocks.push(`  ${label}  ${chalk.white(line.value)}`);
  }

  return blocks.join('\n');
}

export function formatLogSection(title: string, width = DEFAULT_WIDTH): string {
  const text = ` ${title} `;
  const dashes = Math.max(4, width - displayWidth(text));
  return chalk.dim(`──${text}${'─'.repeat(dashes)}`);
}

/** 将列表格式化为 · 分隔的标签行（不自动换行，由调用方控制每行条数） */
export function formatChipList(items: string[], separator = ' · '): string {
  if (items.length === 0) return chalk.dim('(none)');
  return items.map((s) => chalk.cyan(s)).join(separator);
}

/** 按逗号分段换行，控制每行显示宽度 */
export function wrapCommaSeparated(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || displayWidth(text) <= maxWidth) return [text];
  const parts = text.split(/,\s*/).filter((p) => p.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? `${current}, ${part}` : part;
    if (displayWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = part;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/** 按条数拆成多行 chip 列表（条目可含 chalk 着色，不再套一层 cyan） */
export function formatChipListLinesRaw(items: string[], perLine = 7, separator = ' · '): string {
  if (items.length === 0) return chalk.dim('(none)');
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += perLine) {
    lines.push(items.slice(i, i + perLine).join(separator));
  }
  return lines.join('\n');
}

/** 按条数拆成多行 chip 列表 */
export function formatChipListLines(items: string[], perLine = 7, separator = ' · '): string {
  if (items.length === 0) return chalk.dim('(none)');
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += perLine) {
    lines.push(formatChipList(items.slice(i, i + perLine), separator));
  }
  return lines.join('\n');
}
