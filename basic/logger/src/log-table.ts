/**
 * 终端表格格式化（plain / box 两种样式，纯文本或 chalk 着色）。
 */
import chalk from 'chalk';
import { displayWidth, padDisplayEnd, padDisplayStart, stripAnsi, truncateDisplayEnd } from './terminal-width.js';

function hasAnsi(text: string): boolean {
  return stripAnsi(text) !== text;
}

export interface LogTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
}

export interface FormatLogTableOptions {
  style?: 'plain' | 'box';
  title?: string;
  totalsRow?: Record<string, string | number>;
  zeroDot?: boolean;
  /** 不渲染表头行（适合键值对表格） */
  hideHeader?: boolean;
  /** 值按纯文本展示，不做数字高亮 */
  plainValues?: boolean;
  /** 首列标签使用 dim 样式 */
  dimFirstColumn?: boolean;
  /** 列宽上限（显示宽度） */
  maxWidths?: Partial<Record<string, number>>;
  /** 在这些行索引之后插入横向分隔线 */
  sectionBreaks?: number[];
}

export interface LogKvRow {
  label: string;
  value: string;
  [key: string]: string;
}

function cellText(
  value: string | number | undefined | null,
  zeroDot: boolean,
): string {
  if (value === undefined || value === null || value === '') return chalk.dim('·');
  if (value === '-' || value === 0 || value === '0') {
    return zeroDot ? chalk.dim('·') : chalk.dim('-');
  }
  const n = Number(value);
  if (!Number.isNaN(n) && n > 0) return chalk.green(String(n));
  return String(value);
}

function plainCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function computeWidths(
  columns: LogTableColumn[],
  rows: Array<Record<string, string | number | undefined | null>>,
  totalsRow?: Record<string, string | number>,
  maxWidths?: Partial<Record<string, number>>,
): number[] {
  const allRows = totalsRow ? [...rows, totalsRow] : rows;
  return columns.map((col) => {
    const candidates = [
      displayWidth(col.header),
      ...allRows.map((row) => {
        const raw = row[col.key];
        const text = raw === '-' || raw === '·' ? '·' : String(raw ?? '-');
        return displayWidth(text);
      }),
    ];
    const natural = Math.max(...candidates);
    const cap = maxWidths?.[col.key];
    // 显式 maxWidths 时采用固定列宽（键值表换行场景），避免各行边框错位
    if (cap != null) return cap;
    return natural;
  });
}

function padCell(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const fitted = displayWidth(text) > width ? truncateDisplayEnd(text, width) : text;
  return align === 'right' ? padDisplayStart(fitted, width) : padDisplayEnd(fitted, width);
}

function formatPlainRow(
  columns: LogTableColumn[],
  widths: number[],
  record: Record<string, string | number | undefined | null>,
): string {
  return columns
    .map((col, index) => padCell(plainCell(record[col.key]), widths[index]!, col.align))
    .join('  ');
}

function formatBoxRow(
  columns: LogTableColumn[],
  widths: number[],
  record: Record<string, string | number | undefined | null>,
  zeroDot: boolean,
  isFooter: boolean,
  options: Pick<FormatLogTableOptions, 'plainValues' | 'dimFirstColumn'> = {},
): string {
  const { plainValues = false, dimFirstColumn = false } = options;
  const firstKey = columns[0]?.key;
  const cells = columns.map((col, index) => {
    const raw = record[col.key];
    let text: string;
    if (isFooter && col.key === 'plugin') {
      text = chalk.bold.dim(String(raw ?? '合计'));
    } else if (isFooter) {
      const n = typeof raw === 'number' ? raw : Number(raw);
      text = !Number.isNaN(n) && n > 0
        ? chalk.bold.yellow(String(raw))
        : chalk.dim('·');
    } else if (plainValues) {
      const str = raw === undefined || raw === null ? '' : String(raw);
      if (dimFirstColumn && col.key === firstKey && str !== '') {
        text = chalk.dim(str);
      } else if (str === '') {
        text = '';
      } else {
        text = hasAnsi(str) ? str : chalk.white(str);
      }
    } else {
      text = cellText(raw, zeroDot);
    }
    const padded = padCell(text, widths[index]!, col.align);
    return ` ${padded} `;
  });
  return chalk.dim('│') + cells.join(chalk.dim('│')) + chalk.dim('│');
}

function formatBoxBorder(
  widths: number[],
  kind: 'top' | 'mid' | 'bottom',
): string {
  const segments = widths.map((w) => '─'.repeat(w + 2));
  const join = kind === 'top' ? chalk.dim('┬') : kind === 'mid' ? chalk.dim('┼') : chalk.dim('┴');
  const left = kind === 'top' ? chalk.dim('╭') : kind === 'mid' ? chalk.dim('├') : chalk.dim('╰');
  const right = kind === 'top' ? chalk.dim('╮') : kind === 'mid' ? chalk.dim('┤') : chalk.dim('╯');
  return left + segments.join(join) + right;
}

export function formatLogTable(
  columns: LogTableColumn[],
  rows: Array<Record<string, string | number | undefined | null>>,
  options: FormatLogTableOptions = {},
): string {
  if (columns.length === 0) return chalk.dim('(empty table)');
  if (rows.length === 0) return chalk.dim('(empty table)');

  const { style = 'box', title, totalsRow, zeroDot = true, hideHeader = false, plainValues = false, dimFirstColumn = false, maxWidths, sectionBreaks } = options;
  const widths = computeWidths(columns, rows, totalsRow, maxWidths);
  const rowOptions = { plainValues, dimFirstColumn };

  if (style === 'plain') {
    const header = formatPlainRow(columns, widths, Object.fromEntries(columns.map((c) => [c.key, c.header])));
    const separator = widths.map((w) => '-'.repeat(w)).join('  ');
    const body = rows.map((row) => formatPlainRow(columns, widths, row)).join('\n');
    const footer = totalsRow ? `\n${formatPlainRow(columns, widths, totalsRow)}` : '';
    const head = title ? `${title}\n` : '';
    return `${head}${header}\n${separator}\n${body}${footer}`;
  }

  const headerCells = columns.map((col, index) => {
    const text = chalk.bold.dim(col.header);
    return ` ${padCell(text, widths[index]!)} `;
  });
  const headerRow = chalk.dim('│') + headerCells.join(chalk.dim('│')) + chalk.dim('│');

  const lines: string[] = [];
  if (title) lines.push(chalk.bold.cyan(title));
  lines.push(formatBoxBorder(widths, 'top'));
  if (!hideHeader) {
    lines.push(headerRow);
    lines.push(formatBoxBorder(widths, 'mid'));
  }
  for (let i = 0; i < rows.length; i++) {
    lines.push(formatBoxRow(columns, widths, rows[i]!, zeroDot, false, rowOptions));
    if (sectionBreaks?.includes(i)) {
      lines.push(formatBoxBorder(widths, 'mid'));
    }
  }
  if (totalsRow) {
    lines.push(formatBoxBorder(widths, 'mid'));
    lines.push(formatBoxRow(columns, widths, totalsRow, zeroDot, true, rowOptions));
  }
  lines.push(formatBoxBorder(widths, 'bottom'));
  return lines.join('\n');
}

/** 键值对表格（无表头，标签 + 值两列） */
export interface FormatLogKvTableOptions {
  title?: string;
  /** 在这些行索引之后插入横向分隔线 */
  sectionBreaks?: number[];
  /** 值列最大显示宽度 */
  maxValueWidth?: number;
}

export function formatLogKvTable(
  rows: LogKvRow[],
  options: FormatLogKvTableOptions = {},
): string {
  if (rows.length === 0) return chalk.dim('(empty table)');
  const { title, sectionBreaks, maxValueWidth } = options;
  return formatLogTable(
    [
      { key: 'label', header: '' },
      { key: 'value', header: '' },
    ],
    rows,
    {
      title,
      hideHeader: true,
      plainValues: true,
      dimFirstColumn: true,
      zeroDot: false,
      sectionBreaks,
      maxWidths: maxValueWidth != null ? { value: maxValueWidth } : undefined,
    },
  );
}

export function buildLogTableTotalsRow(
  columns: LogTableColumn[],
  rows: Array<Record<string, string | number | undefined | null>>,
  label = '合计',
): Record<string, string | number> {
  const totals: Record<string, string | number> = { plugin: label };
  for (const col of columns) {
    if (col.key === 'plugin') continue;
    let sum = 0;
    let hasNumber = false;
    for (const row of rows) {
      const v = row[col.key];
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isNaN(n) && n > 0) {
        sum += n;
        hasNumber = true;
      }
    }
    totals[col.key] = hasNumber ? sum : 0;
  }
  return totals;
}
