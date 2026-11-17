/**
 * `DataTable` on the `@zhin.js/console-ui` table (ADR 0063 P2): search, sorting, paging, selection
 * with batch actions, row actions and expandable rows. In a container narrower than `sm` the
 * console-ui `Table` turns its rows into cards by itself (D18 第 6 条) instead of scrolling sideways.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  ContentStack,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@zhin.js/console-ui';
import { useLocale, type PluginUiLocale, type PluginUiText } from '../ui/locale.js';
import { ActionButton, EmptyBlock, ToneBadge } from '../renderer/kit.js';
import {
  pickText,
  resolveDataPath,
  type BadgeTone,
  type ButtonVariant,
  type DeclarativeColumnType,
  type DeclarativeI18nText,
} from './model.js';
import { renderSmartValue, type CopyState } from './values.js';

export const TABLE_PAGE_SIZE = 15;

export interface DataTableBatchAction<TRow = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  /** `danger` renders as an outline button and always asks for confirmation (ADR 0063 决策 5). */
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly disabled?: boolean | ((selectedRows: readonly TRow[], selectedKeys: readonly string[]) => boolean);
  /** Shows the action as running. */
  readonly busy?: boolean;
  readonly onExecute: (selectedRows: readonly TRow[], selectedKeys: readonly string[]) => unknown;
}

export interface DataTableRowAction<TRow = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  /** `danger` renders as an outline button and always asks for confirmation (ADR 0063 决策 5). */
  readonly variant?: ButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly disabled?: boolean | ((row: TRow, index: number) => boolean);
  /** Shows the action as running for this row. */
  readonly busy?: boolean | ((row: TRow, index: number) => boolean);
  readonly onExecute: (row: TRow, index: number) => unknown;
}

export interface DataTableColumn<TRow = Record<string, unknown>> {
  readonly key: keyof TRow & string;
  readonly label: DeclarativeI18nText;
  readonly icon?: React.ReactNode;
  readonly type?: DeclarativeColumnType;
  readonly align?: 'left' | 'center' | 'right';
  /**
   * @deprecated Ignored since ADR 0063 P2: a narrow container shows cards instead of a sideways
   * scrolling table, so there are no sticky columns.
   */
  readonly fixed?: 'left' | 'right';
  readonly sortable?: boolean;
  readonly copyable?: boolean;
  readonly width?: string | number;
  readonly toneMap?: Readonly<Record<string, BadgeTone>>;
  readonly render?: (value: unknown, row: TRow, index: number) => React.ReactNode;
}

export interface DataTableProps<TRow = Record<string, unknown>> {
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey?: keyof TRow & string;
  readonly searchable?: boolean;
  readonly pageSize?: number;
  readonly emptyTitle?: DeclarativeI18nText;
  /** Controls on the toolbar row, after the search box and the count. */
  readonly actions?: React.ReactNode;
  /** 是否开启多选行（配置 `batchActions` 时自动开启）。 */
  readonly selectable?: boolean;
  /** 受控选中行 Key 列表。 */
  readonly selectedKeys?: readonly string[];
  /** 选中行变化回调。 */
  readonly onSelectionChange?: (selectedKeys: string[], selectedRows: TRow[]) => void;
  /** 批量操作（选中行后出现）。 */
  readonly batchActions?: readonly DataTableBatchAction<TRow>[];
  /** 行级操作按钮。 */
  readonly rowActions?: readonly DataTableRowAction<TRow>[];
  /** 可展开详情行渲染函数。 */
  readonly renderExpandedRow?: (row: TRow, index: number) => React.ReactNode;
  /**
   * @deprecated Always on since ADR 0063 P2: a narrow container shows one card per row.
   */
  readonly responsiveStack?: boolean;
  /** Dictionary for column labels and texts (declarative pages pass theirs). */
  readonly dictionary?: Readonly<Record<string, string>>;
}

type SortState = { readonly key: string; readonly dir: 'asc' | 'desc' } | undefined;

export function rowKeyOf<TRow extends Record<string, unknown>>(row: TRow, index: number, rowKey: string | undefined, firstColumn: string | undefined): string {
  const raw = (rowKey ? resolveDataPath(row, rowKey) : undefined)
    ?? row.id ?? row.key ?? row.ownerKey
    ?? (firstColumn ? resolveDataPath(row, firstColumn) : undefined)
    ?? index;
  return String(raw);
}

function matches(row: Record<string, unknown>, columns: readonly { readonly key: string }[], query: string): boolean {
  const values = [
    ...columns.map(column => resolveDataPath(row, column.key)),
    ...Object.values(row ?? {}).filter(value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
  ];
  return values.some(value => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.map(String).join(' ').toLowerCase().includes(query);
    if (typeof value === 'object') return false;
    return String(value).toLowerCase().includes(query);
  });
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Filter, sort and page; pure, shared with tests. */
export function tableView<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  columns: readonly { readonly key: string }[],
  options: { readonly query?: string; readonly sort?: SortState; readonly page?: number; readonly pageSize?: number },
) {
  const query = (options.query ?? '').trim().toLowerCase();
  const filtered = query ? rows.filter(row => matches(row, columns, query)) : rows;
  const sort = options.sort;
  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const order = compare(resolveDataPath(a, sort.key), resolveDataPath(b, sort.key));
        return sort.dir === 'asc' ? order : -order;
      })
    : filtered;
  const pageSize = options.pageSize ?? TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, options.page ?? 1), totalPages);
  return { query, rows: sorted, total: sorted.length, totalPages, page, paged: sorted.slice((page - 1) * pageSize, page * pageSize), offset: (page - 1) * pageSize };
}

const nextSort = (current: SortState, key: string): SortState =>
  !current || current.key !== key ? { key, dir: 'asc' } : current.dir === 'asc' ? { key, dir: 'desc' } : undefined;

function useCopy(): CopyState {
  const [copiedKey, setCopiedKey] = useState('');
  const onCopy = useCallback((key: string, text: string) => {
    try {
      void globalThis.navigator?.clipboard?.writeText?.(text);
    } catch {
      // clipboard unavailable (insecure context, tests)
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(previous => (previous === key ? '' : previous)), 1_500);
  }, []);
  return useMemo(() => ({ copiedKey, onCopy }), [copiedKey, onCopy]);
}

function actionText(text: DeclarativeI18nText | undefined, locale: PluginUiLocale, t: PluginUiText['t']): string | undefined {
  return text === undefined ? undefined : pickText(text, locale, t);
}

/** 通用数据表格：搜索、排序、分页、多选与批量操作、行操作、可展开行；窄容器下每行一张卡片。 */
export function DataTable<TRow extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  searchable = true,
  pageSize = TABLE_PAGE_SIZE,
  emptyTitle,
  actions,
  selectable,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
  batchActions,
  rowActions,
  renderExpandedRow,
  dictionary,
}: DataTableProps<TRow>) {
  const { locale, t } = useLocale(dictionary);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>();
  const [internalSelected, setInternalSelected] = useState<readonly string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);
  const copy = useCopy();

  const isSelectable = Boolean(selectable || (batchActions && batchActions.length > 0) || onSelectionChange);
  const selected = controlledSelectedKeys ?? internalSelected;
  const selectedSet = new Set(selected);
  const expandedSet = new Set(expandedKeys);
  const firstColumn = columns[0]?.key;
  const keyOf = (row: TRow, index: number) => rowKeyOf(row, index, rowKey, firstColumn);

  const view = tableView(rows, columns, { query, sort, page, pageSize });
  const pageKeys = view.paged.map((row, index) => keyOf(row, view.offset + index));
  const allPageSelected = pageKeys.length > 0 && pageKeys.every(key => selectedSet.has(key));
  const somePageSelected = !allPageSelected && pageKeys.some(key => selectedSet.has(key));
  const selectedRows = rows.filter((row, index) => selectedSet.has(keyOf(row, index)));

  const updateSelection = (next: string[]) => {
    if (controlledSelectedKeys === undefined) setInternalSelected(next);
    if (onSelectionChange) {
      const set = new Set(next);
      onSelectionChange(next, rows.filter((row, index) => set.has(keyOf(row, index))));
    }
  };
  const toggleRow = (key: string, checked: boolean) => {
    const set = new Set(selected);
    if (checked) set.add(key);
    else set.delete(key);
    updateSelection([...set]);
  };
  const togglePage = (checked: boolean) => {
    const set = new Set(selected);
    for (const key of pageKeys) {
      if (checked) set.add(key);
      else set.delete(key);
    }
    updateSelection([...set]);
  };
  const toggleExpanded = (key: string) => setExpandedKeys(previous => (previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]));

  const label = (column: DataTableColumn<TRow>) => pickText(column.label, locale, t);
  const cell = (column: DataTableColumn<TRow>, row: TRow, index: number) => {
    const value = resolveDataPath(row, column.key);
    return column.render ? column.render(value, row, index) : renderSmartValue(value, column.key, `dt-r${index}-${column.key}`, copy, t, column);
  };
  const rowActionButtons = (row: TRow, index: number) => (rowActions ?? []).map((action, actionIndex) => {
    const text = pickText(action.label, locale, t);
    return (
      <ActionButton
        key={action.key ?? actionIndex}
        label={text}
        icon={action.icon}
        variant={action.variant}
        fallbackVariant="ghost"
        locale={locale}
        confirm={actionText(action.confirm, locale, t)}
        confirmLabel={actionText(action.confirmLabel, locale, t)}
        disabled={typeof action.disabled === 'function' ? action.disabled(row, index) : Boolean(action.disabled)}
        busy={typeof action.busy === 'function' ? action.busy(row, index) : Boolean(action.busy)}
        onRun={() => action.onExecute(row, index)}
      />
    );
  });
  const expandToggle = (key: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={expandedSet.has(key)}
      aria-label={expandedSet.has(key) ? t('收起详情') : t('展开详情')}
      onClick={() => toggleExpanded(key)}
    >
      {expandedSet.has(key) ? '▾' : '▸'}
    </Button>
  );
  const rowCheckbox = (key: string) => (
    <Checkbox checked={selectedSet.has(key)} aria-label={t('选择行')} onCheckedChange={checked => toggleRow(key, checked === true)} />
  );
  const hasRowActions = Boolean(rowActions && rowActions.length > 0);
  const columnSpan = columns.length + (isSelectable ? 1 : 0) + (renderExpandedRow ? 1 : 0) + (hasRowActions ? 1 : 0);
  const showSearch = searchable && (rows.length >= 3 || view.query.length > 0);

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {isSelectable ? (
            <TableHead>
              <Checkbox
                checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                aria-label={allPageSelected ? t('取消全选') : t('全选当前页')}
                onCheckedChange={checked => togglePage(checked === true)}
              />
            </TableHead>
          ) : null}
          {renderExpandedRow ? <TableHead aria-label={t('展开详情')} /> : null}
          {columns.map(column => {
            const sorted = sort?.key === column.key ? sort.dir : undefined;
            const canSort = column.sortable !== false && rows.length >= 2;
            return (
              <TableHead
                key={column.key}
                numeric={column.align === 'right' || column.type === 'number'}
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
              >
                {canSort ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSort(current => nextSort(current, column.key))} title={t('点击排序')}>
                    {column.icon}{label(column)}{sorted ? <span aria-hidden="true">{sorted === 'asc' ? '↑' : '↓'}</span> : null}
                  </Button>
                ) : <>{column.icon}{label(column)}</>}
              </TableHead>
            );
          })}
          {hasRowActions ? <TableHead numeric>{t('操作')}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.paged.map((row, index) => {
          const absolute = view.offset + index;
          const key = keyOf(row, absolute);
          return (
            <React.Fragment key={key}>
              <TableRow data-selected={selectedSet.has(key) ? 'true' : undefined}>
                {isSelectable ? <TableCell>{rowCheckbox(key)}</TableCell> : null}
                {renderExpandedRow ? <TableCell>{expandToggle(key)}</TableCell> : null}
                {columns.map(column => (
                  <TableCell key={column.key} numeric={column.align === 'right' || column.type === 'number'}>{cell(column, row, absolute)}</TableCell>
                ))}
                {hasRowActions ? (
                  <TableCell numeric>
                    <ContentStack direction="row" gap="tight" justify="end">{rowActionButtons(row, absolute)}</ContentStack>
                  </TableCell>
                ) : null}
              </TableRow>
              {renderExpandedRow && expandedSet.has(key) ? (
                <TableRow data-expanded-row="">
                  <TableCell colSpan={columnSpan}>{renderExpandedRow(row, absolute)}</TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <ContentStack gap="tight" data-data-table="">
      {showSearch || actions ? (
        <ContentStack direction="row" gap="tight" justify="between" align="center">
          <ContentStack direction="row" gap="tight" align="center">
            {showSearch ? (
              <Input
                type="search"
                aria-label={t('搜索…')}
                placeholder={t('搜索…')}
                value={query}
                onChange={event => { setQuery(event.target.value); setPage(1); }}
              />
            ) : null}
            <span className="console-form-field-hint" data-row-count="">
              {view.query ? t('共 {0} / {1} 条', view.total, rows.length) : t('共 {0} 条', rows.length)}
            </span>
          </ContentStack>
          {actions ? <ContentStack direction="row" gap="tight" align="center">{actions}</ContentStack> : null}
        </ContentStack>
      ) : null}

      {isSelectable && selected.length > 0 ? (
        <div role="region" aria-label={t('批量操作')} data-batch-bar="">
          <ContentStack direction="row" gap="tight" align="center" justify="between">
            <ContentStack direction="row" gap="tight" align="center">
              <ToneBadge tone="primary">{t('已选 {0} 项', selected.length)}</ToneBadge>
              <Button type="button" variant="ghost" size="sm" onClick={() => updateSelection([])}>{t('清空选择')}</Button>
            </ContentStack>
            <ContentStack direction="row" gap="tight" align="center">
              {(batchActions ?? []).map((action, index) => {
                const text = pickText(action.label, locale, t);
                return (
                  <ActionButton
                    key={action.key ?? index}
                    label={text}
                    icon={action.icon}
                    variant={action.variant}
                    fallbackVariant="soft"
                    locale={locale}
                    confirm={actionText(action.confirm, locale, t)}
                    confirmLabel={actionText(action.confirmLabel, locale, t)}
                    busy={action.busy}
                    disabled={typeof action.disabled === 'function' ? action.disabled(selectedRows, selected) : Boolean(action.disabled)}
                    onRun={() => action.onExecute(selectedRows, selected)}
                  />
                );
              })}
            </ContentStack>
          </ContentStack>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyBlock title={emptyTitle ? pickText(emptyTitle, locale, t) : t('暂无数据')} />
      ) : view.paged.length === 0 ? (
        <EmptyBlock
          title={t('无匹配记录')}
          action={<Button type="button" variant="ghost" size="sm" onClick={() => setQuery('')}>{t('清除过滤')}</Button>}
        />
      ) : (
        table
      )}

      {view.totalPages > 1 ? (
        <ContentStack direction="row" gap="tight" justify="between" align="center" data-pagination="">
          <span className="console-form-field-hint">{t('第 {0} / {1} 页（共 {2} 条）', view.page, view.totalPages, view.total)}</span>
          <ContentStack direction="row" gap="tight">
            <Button type="button" variant="outline" size="sm" disabled={view.page <= 1} onClick={() => setPage(Math.max(1, view.page - 1))}>{t('上一页')}</Button>
            <Button type="button" variant="outline" size="sm" disabled={view.page >= view.totalPages} onClick={() => setPage(Math.min(view.totalPages, view.page + 1))}>{t('下一页')}</Button>
          </ContentStack>
        </ContentStack>
      ) : null}
    </ContentStack>
  );
}
