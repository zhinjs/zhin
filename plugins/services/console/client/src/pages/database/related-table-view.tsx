import { useState, useEffect, useCallback, useMemo } from 'react'
import type { TableInfo, SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../../components/ui/dialog'
import { JsonField } from './json-field'

export function RelatedTableView({
  tableName,
  tableInfo,
  select,
  insert,
  update,
  remove,
}: {
  tableName: string
  tableInfo?: TableInfo
  select: (table: string, page?: number, pageSize?: number, where?: any) => Promise<SelectResult>
  insert: (table: string, row: any) => Promise<any>
  update: (table: string, row: any, where: any) => Promise<any>
  remove: (table: string, where: any) => Promise<any>
}) {
  const [data, setData] = useState<SelectResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editRow, setEditRow] = useState<any>(null)
  const [addRow, setAddRow] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const result = await select(tableName, page, pageSize)
      setData(result)
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [tableName, page, select])

  useEffect(() => { load() }, [load])

  const columns = useMemo(() => {
    if (tableInfo?.columns) return Object.keys(tableInfo.columns)
    if (data?.rows?.length) return Object.keys(data.rows[0])
    return []
  }, [tableInfo, data])

  const primaryKey = useMemo(() => {
    if (!tableInfo?.columns) return columns[0] || 'id'
    const pk = Object.entries(tableInfo.columns).find(([, col]: [string, any]) => col.primary)
    return pk ? pk[0] : columns[0] || 'id'
  }, [tableInfo, columns])

  const handleSave = async (isNew: boolean) => {
    try {
      const row: any = {}
      for (const col of columns) {
        const val = formData[col]
        if (val === undefined || val === '') continue
        try { row[col] = JSON.parse(val) } catch { row[col] = val }
      }
      if (isNew) {
        await insert(tableName, row)
      } else {
        const where: any = { [primaryKey]: editRow[primaryKey] }
        await update(tableName, row, where)
      }
      setMsg({ type: 'success', text: isNew ? '添加成功' : '更新成功' })
      setEditRow(null)
      setAddRow(false)
      setFormData({})
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
  }

  const handleDelete = async (row: any) => {
    if (!confirm('确定要删除这条记录吗？')) return
    try {
      await remove(tableName, { [primaryKey]: row[primaryKey] })
      setMsg({ type: 'success', text: '删除成功' })
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
  }

  const openEdit = (row: any) => {
    setEditRow(row)
    setAddRow(false)
    const fd: Record<string, string> = {}
    for (const col of columns) {
      fd[col] = typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')
    }
    setFormData(fd)
  }

  const openAdd = () => {
    setEditRow(null)
    setAddRow(true)
    const fd: Record<string, string> = {}
    for (const col of columns) fd[col] = ''
    setFormData(fd)
  }

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="space-y-3">
      {msg && (
        <Alert variant={msg.type === 'error' ? 'destructive' : 'success'} className="py-2">
          {msg.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
        <Button size="sm" onClick={openAdd}><Plus className="w-3.5 h-3.5 mr-1" />添加</Button>
        <span className="text-xs text-muted-foreground ml-auto">
          共 {data?.total ?? 0} 条 · 第 {page}/{totalPages || 1} 页
        </span>
      </div>

      <div
        className="border rounded-md max-h-[min(70vh,720px)] overflow-auto overscroll-contain scroll-smooth touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label="数据表，可左右滑动查看宽表"
      >
        <table className="text-sm border-collapse min-w-full w-max">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm shadow-sm">
            <tr className="border-b">
              {columns.map((col: string) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap border-b border-border/80"
                >
                  {col}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap border-b border-border/80 w-24 min-w-[5.5rem]">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={columns.length + 1} className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></td></tr>
            ) : !data?.rows?.length ? (
              <tr><td colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
            ) : data.rows.map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                {columns.map((col: string) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 font-mono text-xs whitespace-nowrap align-top"
                    title={typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                  >
                    {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right space-x-1 whitespace-nowrap w-24 min-w-[5.5rem]">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(row)}><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(row)}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      <Dialog open={editRow !== null || addRow} onOpenChange={(open) => { if (!open) { setEditRow(null); setAddRow(false) } }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{addRow ? '添加记录' : '编辑记录'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {columns.map((col: string) => (
              <JsonField
                key={col}
                label={col}
                value={formData[col] ?? ''}
                onChange={(v: string) => setFormData((prev: Record<string, string>) => ({ ...prev, [col]: v }))}
              />
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">取消</Button></DialogClose>
            <Button size="sm" onClick={() => handleSave(addRow)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
