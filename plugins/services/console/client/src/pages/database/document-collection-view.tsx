import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import type { SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
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

export function DocumentCollectionView({
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

      <Dialog open={editDoc !== null || addDoc} onOpenChange={(open) => { if (!open) { setEditDoc(null); setAddDoc(false) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{addDoc ? '添加文档' : '编辑文档'}</DialogTitle></DialogHeader>
          <textarea
            value={jsonText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setJsonText(e.target.value)}
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
