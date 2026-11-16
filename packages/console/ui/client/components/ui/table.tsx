import type * as React from "react"
import { forwardRef, useCallback, useEffect, useRef } from "react"
import { cn } from '../../cn.js'

/**
 * Shared data table (ADR 0063 D15, D18): compact rows, one header treatment, numeric columns that
 * right-align with tabular figures (`numeric` on TableHead / TableCell).
 *
 * The table is a size container: below 40rem of its own width every row becomes a card, each
 * cell labelled with its column header (taken from the header row, or `label` on the cell);
 * cells marked `priority="secondary"` are left out of the cards. No horizontal scrolling on phones.
 */
type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  containerClassName?: string
  /** `compact` uses the compact control height for controls inside cells (2rem on wide screens). */
  density?: "default" | "compact"
}

/** Copies the column headers into `data-label` of every body cell that has no label of its own. */
export function syncTableCellLabels(table: HTMLTableElement): void {
  const headers = [...table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:last-child > th")]
    .map((cell) => cell.textContent?.trim() ?? "")
  if (!headers.length) return
  for (const row of table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")) {
    let column = 0
    for (const cell of row.cells) {
      const label = headers[column]
      if (label && (!cell.hasAttribute("data-label") || cell.dataset.labelAuto === "true")) {
        cell.dataset.label = label
        cell.dataset.labelAuto = "true"
      }
      column += cell.colSpan || 1
    }
  }
}

const Table = forwardRef<HTMLTableElement, TableProps>(({ className, containerClassName, density = "default", ...props }, ref) => {
  const own = useRef<HTMLTableElement | null>(null)
  const setRef = useCallback((node: HTMLTableElement | null) => {
    own.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])
  // Runs after every render of the table, so rows added later get their labels too.
  useEffect(() => { if (own.current) syncTableCellLabels(own.current) })
  return (
    <div className={cn("console-table console-cq", containerClassName)} data-slot="table" data-density={density}>
      <div className="console-table-scroll">
        <table ref={setRef} className={className} {...props} />
      </div>
    </div>
  )
})
Table.displayName = "Table"

type SectionProps = React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }

const TableHeader = forwardRef<HTMLTableSectionElement, SectionProps>(({ className, sticky, ...props }, ref) => (
  <thead ref={ref} className={cn(sticky && "sticky top-0 z-10 bg-card", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={className} {...props} />
))
TableBody.displayName = "TableBody"

const TableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={className} {...props} />
))
TableRow.displayName = "TableRow"

type CellProps<T> = T & {
  numeric?: boolean
  /** `secondary` cells are hidden when the table turns into cards (narrow containers). */
  priority?: "primary" | "secondary"
}

const TableHead = forwardRef<HTMLTableCellElement, CellProps<React.ThHTMLAttributes<HTMLTableCellElement>>>(
  ({ className, numeric, priority, scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      data-numeric={numeric ? "" : undefined}
      data-priority={priority}
      className={className}
      {...props}
    />
  ),
)
TableHead.displayName = "TableHead"

const TableCell = forwardRef<HTMLTableCellElement, CellProps<React.TdHTMLAttributes<HTMLTableCellElement>> & {
  /** Label shown in card mode; defaults to the column header. */
  label?: string
}>(
  ({ className, numeric, priority, label, ...props }, ref) => (
    <td
      ref={ref}
      data-numeric={numeric ? "" : undefined}
      data-priority={priority}
      data-label={label}
      className={className}
      {...props}
    />
  ),
)
TableCell.displayName = "TableCell"

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
