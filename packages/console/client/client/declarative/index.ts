/** Declarative page renderer (`@zhin.js/client` root entry, ADR 0063 D14). */
export {
  DECLARATIVE_PAGE_CAPABILITIES,
  DeclarativePageView,
  createDeclarativePage,
} from './DeclarativePageView.js';
export {
  DataTable,
  type DataTableBatchAction,
  type DataTableColumn,
  type DataTableProps,
  type DataTableRowAction,
} from './DataTable.js';
export type {
  BadgeTone as DeclarativeBadgeTone,
  ButtonVariant as DeclarativeButtonVariant,
  DeclarativeActionFieldSpec,
  DeclarativeActionResultSpec,
  DeclarativeActionSpec,
  DeclarativeBadgeSpec,
  DeclarativeBatchActionSpec,
  DeclarativeColumnSpec,
  DeclarativeColumnType,
  DeclarativeI18nText,
  DeclarativePageComponentProps,
  DeclarativePageContext,
  DeclarativePageSpec,
  DeclarativeRowActionSpec,
  DeclarativeSectionSpec,
  DeclarativeStatSpec,
  DeclarativeValueExpr,
} from './model.js';
