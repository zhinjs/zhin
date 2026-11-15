import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

/**
 * Shared data table: horizontally scrollable container, one header treatment and
 * numeric columns that right-align with tabular figures. Pass `numeric` on
 * TableHead/TableCell for number columns.
 */
type TableProps = React.TableHTMLAttributes<HTMLTableElement> & { containerClassName?: string }

const Table = forwardRef<HTMLTableElement, TableProps>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn("w-full max-w-full overflow-x-auto", containerClassName)}>
    <table ref={ref} className={cn("w-full border-collapse text-[length:var(--console-text-body-sm)]", className)} {...props} />
  </div>
))
Table.displayName = "Table"

type SectionProps = React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }

const TableHeader = forwardRef<HTMLTableSectionElement, SectionProps>(({ className, sticky, ...props }, ref) => (
  <thead ref={ref} className={cn(sticky && "sticky top-0 z-10 backdrop-blur-sm", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={className} {...props} />
))
TableBody.displayName = "TableBody"

const TableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("border-b border-border/70 transition-colors last:border-0 hover:bg-[var(--console-surface-hover)]", className)} {...props} />
))
TableRow.displayName = "TableRow"

type CellProps<T> = T & { numeric?: boolean }

const TableHead = forwardRef<HTMLTableCellElement, CellProps<React.ThHTMLAttributes<HTMLTableCellElement>>>(
  ({ className, numeric, scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "whitespace-nowrap border-b border-border bg-transparent px-3 py-2.5 align-middle text-[length:var(--console-text-label)] font-medium text-muted-foreground",
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    />
  ),
)
TableHead.displayName = "TableHead"

const TableCell = forwardRef<HTMLTableCellElement, CellProps<React.TdHTMLAttributes<HTMLTableCellElement>>>(
  ({ className, numeric, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-2 align-middle", numeric && "text-right tabular-nums", className)} {...props} />
  ),
)
TableCell.displayName = "TableCell"

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
