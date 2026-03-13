import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDatabase } from '@zhin.js/client'
import type { DatabaseType, TableInfo, SelectResult, KvEntry } from '@zhin.js/client'
import {
  Database, Table2, Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle,
  CheckCircle, Search, ChevronLeft, ChevronRight, X, Save, Key
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { ScrollArea } from '../components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'

// ── 通用 JSON 编辑器 ───────────────────────────────────────────────

function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e: any) => onChange(e.target.value)} className="font-mono text-xs" />
    </div>
  )
}

// ── 关系型数据库表视图 ─────────────────────────────────────────────

function RelatedTableView({
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

      {/* 数据表格 */}
      <ScrollArea className="border rounded-md">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                ))}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={columns.length + 1} className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></td></tr>
              ) : !data?.rows?.length ? (
                <tr><td colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
              ) : data.rows.map((row: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                  {columns.map((col: string) => (
                    <td key={col} className="px-3 py-1.5 font-mono text-xs max-w-[300px] truncate">
                      {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(row)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(row)}><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {/* 编辑/新增弹窗 */}
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

// ── 文档型数据库集合视图 ───────────────────────────────────────────

function DocumentCollectionView({
  tableName,
  select,
  insert,
  update,
  remove,
}: {
  tableName: string
  select: (table: string, page?: number, pageSize?: number, where?: any) => Promise<SelectResult>
  insert: (table: string, row: any) => Promise<any>
  update: (table: string, row: any, where: any) => Promise<any>
  remove: (table: string, where: any) => Promise<any>
}) {
  const [data, setData] = useState<SelectResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editDoc, setEditDoc] = useState<any>(null)
  const [addDoc, setAddDoc] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const pageSize = 20

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

  const handleSave = async (isNew: boolean) => {
    try {
      const doc = JSON.parse(jsonText)
      if (isNew) {
        await insert(tableName, doc)
      } else {
        const { _id, ...rest } = doc
        await update(tableName, rest, { _id: editDoc._id })
      }
      setMsg({ type: 'success', text: isNew ? '添加成功' : '更新成功' })
      setEditDoc(null)
      setAddDoc(false)
      setJsonText('')
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
  }

  const handleDelete = async (doc: any) => {
    if (!confirm('确定要删除这条文档吗？')) return
    try {
      await remove(tableName, { _id: doc._id })
      setMsg({ type: 'success', text: '删除成功' })
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
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
        <Button size="sm" onClick={() => { setAddDoc(true); setJsonText('{\n  \n}') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />添加文档
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">共 {data?.total ?? 0} 条 · 第 {page}/{totalPages || 1} 页</span>
      </div>

      {/* 文档列表 */}
      <div className="space-y-2">
        {loading && !data ? (
          <div className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></div>
        ) : !data?.rows?.length ? (
          <p className="text-center py-8 text-muted-foreground text-sm">暂无文档</p>
        ) : data.rows.map((doc: any, i: number) => (
          <Card key={doc._id || i} className="overflow-hidden">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <pre className="text-xs font-mono flex-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(doc, null, 2)}</pre>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => {
                    setEditDoc(doc)
                    setAddDoc(false)
                    setJsonText(JSON.stringify(doc, null, 2))
                  }}><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(doc)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {/* 编辑/新增弹窗 */}
      <Dialog open={editDoc !== null || addDoc} onOpenChange={(open) => { if (!open) { setEditDoc(null); setAddDoc(false) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{addDoc ? '添加文档' : '编辑文档'}</DialogTitle></DialogHeader>
          <textarea
            value={jsonText}
            onChange={(e: any) => setJsonText(e.target.value)}
            className="w-full h-60 font-mono text-xs p-3 border rounded-md resize-none bg-background"
            spellCheck={false}
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">取消</Button></DialogClose>
            <Button size="sm" onClick={() => handleSave(addDoc)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── KV 数据库桶视图 ────────────────────────────────────────────────

function KvBucketView({
  tableName,
  kvGet,
  kvSet,
  kvDelete,
  kvEntries,
}: {
  tableName: string
  kvGet: (table: string, key: string) => Promise<{ key: string; value: any }>
  kvSet: (table: string, key: string, value: any, ttl?: number) => Promise<any>
  kvDelete: (table: string, key: string) => Promise<any>
  kvEntries: (table: string) => Promise<{ entries: KvEntry[] }>
}) {
  const [entries, setEntries] = useState<KvEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editEntry, setEditEntry] = useState<KvEntry | null>(null)
  const [addEntry, setAddEntry] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [valueInput, setValueInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const result = await kvEntries(tableName)
      setEntries(result.entries)
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [tableName, kvEntries])

  useEffect(() => { load() }, [load])

  const handleSave = async (isNew: boolean) => {
    try {
      let val: any
      try { val = JSON.parse(valueInput) } catch { val = valueInput }
      await kvSet(tableName, keyInput, val)
      setMsg({ type: 'success', text: isNew ? '添加成功' : '更新成功' })
      setEditEntry(null)
      setAddEntry(false)
      setKeyInput('')
      setValueInput('')
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
  }

  const handleDelete = async (key: string) => {
    if (!confirm(`确定要删除键 "${key}" 吗？`)) return
    try {
      await kvDelete(tableName, key)
      setMsg({ type: 'success', text: '删除成功' })
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
  }

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
        <Button size="sm" onClick={() => { setAddEntry(true); setKeyInput(''); setValueInput('') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />添加键值
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">共 {entries.length} 个键</span>
      </div>

      {/* KV 列表 */}
      <ScrollArea className="border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/3">Key</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Value</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !entries.length ? (
              <tr><td colSpan={3} className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></td></tr>
            ) : !entries.length ? (
              <tr><td colSpan={3} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.key} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-3 py-1.5 font-mono text-xs"><Key className="w-3 h-3 inline-block mr-1 text-muted-foreground" />{entry.key}</td>
                <td className="px-3 py-1.5 font-mono text-xs max-w-[400px] truncate">
                  {typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value ?? '')}
                </td>
                <td className="px-3 py-1.5 text-right space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => {
                    setEditEntry(entry)
                    setAddEntry(false)
                    setKeyInput(entry.key)
                    setValueInput(typeof entry.value === 'object' ? JSON.stringify(entry.value, null, 2) : String(entry.value ?? ''))
                  }}><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(entry.key)}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      {/* 编辑/新增弹窗 */}
      <Dialog open={editEntry !== null || addEntry} onOpenChange={(open) => { if (!open) { setEditEntry(null); setAddEntry(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{addEntry ? '添加键值' : '编辑键值'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Key</label>
              <Input value={keyInput} onChange={(e: any) => setKeyInput(e.target.value)} className="font-mono text-xs" disabled={!addEntry} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Value (JSON 或纯文本)</label>
              <textarea
                value={valueInput}
                onChange={(e: any) => setValueInput(e.target.value)}
                className="w-full h-32 font-mono text-xs p-3 border rounded-md resize-none bg-background"
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">取消</Button></DialogClose>
            <Button size="sm" onClick={() => handleSave(addEntry)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── 数据库类型标签文本 ─────────────────────────────────────────────

const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  related: '关系型',
  document: '文档型',
  keyvalue: '键值型',
}

const DIALECT_LABELS: Record<string, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  pg: 'PostgreSQL',
  memory: 'Memory',
  mongodb: 'MongoDB',
  redis: 'Redis',
}

// ── 主页面组件 ──────────────────────────────────────────────────────

export default function DatabasePage() {
  const {
    info, tables, loading, error,
    loadInfo, loadTables, dropTable,
    select, insert, update, remove,
    kvGet, kvSet, kvDelete, kvEntries,
  } = useDatabase()

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const selectedTableInfo = useMemo(() => tables.find((t: TableInfo) => t.name === selectedTable), [tables, selectedTable])
  const dbType = info?.type ?? 'related'

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据库管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览和管理{DB_TYPE_LABELS[dbType]}数据库中的数据
          </p>
        </div>
        <div className="flex items-center gap-2">
          {info && (
            <Badge variant="secondary">
              {DIALECT_LABELS[info.dialect] || info.dialect} · {DB_TYPE_LABELS[info.type]}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => { loadInfo().catch(() => {}); loadTables().catch(() => {}) }} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 主体区域 */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex" style={{ minHeight: '500px' }}>
            {/* 左侧表/集合/桶列表 */}
            <div className="w-56 border-r flex flex-col shrink-0">
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {dbType === 'related' ? '数据表' : dbType === 'document' ? '集合' : '桶'}
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && !tables.length ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : !tables.length ? (
                    <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                  ) : tables.map((t: TableInfo) => (
                    <button
                      key={t.name}
                      className={`
                        group w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                        hover:bg-accent transition-colors rounded-sm
                        ${selectedTable === t.name ? 'bg-accent text-accent-foreground font-medium' : ''}
                      `}
                      onClick={() => setSelectedTable(t.name)}
                    >
                      {dbType === 'keyvalue' ? <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1">{t.name}</span>
                      {t.columns && <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">{Object.keys(t.columns).length}</Badge>}
                      <Button
                        size="sm" variant="ghost"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                        onClick={(e: any) => {
                          e.stopPropagation()
                          const label = dbType === 'related' ? '表' : dbType === 'document' ? '集合' : '桶'
                          if (!confirm(`确定要删除${label} "${t.name}" 吗？此操作不可撤销！`)) return
                          dropTable(t.name).then(() => {
                            if (selectedTable === t.name) setSelectedTable(null)
                          }).catch(() => {})
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* 右侧内容 */}
            <div className="flex-1 min-w-0 p-4">
              {selectedTable ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <Table2 className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{selectedTable}</h2>
                    {selectedTableInfo?.columns && (
                      <div className="flex gap-1 ml-2 flex-wrap">
                        {(Object.entries(selectedTableInfo.columns) as [string, { type: string; primary?: boolean }][]).slice(0, 8).map(([col, def]) => (
                          <Badge key={col} variant="outline" className="text-[10px] px-1.5 py-0">
                            {col}{def.primary ? ' 🔑' : ''}: {def.type}
                          </Badge>
                        ))}
                        {Object.keys(selectedTableInfo.columns).length > 8 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{Object.keys(selectedTableInfo.columns).length - 8}</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {dbType === 'keyvalue' ? (
                    <KvBucketView
                      key={selectedTable}
                      tableName={selectedTable}
                      kvGet={kvGet}
                      kvSet={kvSet}
                      kvDelete={kvDelete}
                      kvEntries={kvEntries}
                    />
                  ) : dbType === 'document' ? (
                    <DocumentCollectionView
                      key={selectedTable}
                      tableName={selectedTable}
                      select={select}
                      insert={insert}
                      update={update}
                      remove={remove}
                    />
                  ) : (
                    <RelatedTableView
                      key={selectedTable}
                      tableName={selectedTable}
                      tableInfo={selectedTableInfo}
                      select={select}
                      insert={insert}
                      update={update}
                      remove={remove}
                    />
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">
                      在左侧选择{dbType === 'related' ? '一个表' : dbType === 'document' ? '一个集合' : '一个桶'}开始管理
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
