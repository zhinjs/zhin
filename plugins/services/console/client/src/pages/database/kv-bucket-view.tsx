import { useState, useEffect, useCallback } from 'react'
import type { KvEntry } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, Save, Key } from 'lucide-react'
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
import { Input } from '../../components/ui/input'
import type { ChangeEvent } from 'react'

export function KvBucketView({
  tableName,
  kvGet: _kvGet,
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

      <div
        className="border rounded-md max-h-[min(60vh,560px)] overflow-auto overscroll-contain touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label="键值表，可左右滑动"
      >
        <table className="text-sm border-collapse min-w-full w-max">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
            <tr className="border-b border-border/80">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[8rem]">Key</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[12rem]">Value</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap w-24 min-w-[5.5rem]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !entries.length ? (
              <tr><td colSpan={3} className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></td></tr>
            ) : !entries.length ? (
              <tr><td colSpan={3} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.key} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap align-top">
                  <Key className="w-3 h-3 inline-block mr-1 text-muted-foreground shrink-0" />
                  {entry.key}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap align-top" title={typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value ?? '')}>
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
      </div>

      <Dialog open={editEntry !== null || addEntry} onOpenChange={(open) => { if (!open) { setEditEntry(null); setAddEntry(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{addEntry ? '添加键值' : '编辑键值'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Key</label>
              <Input value={keyInput} onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value)} className="font-mono text-xs" disabled={!addEntry} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Value (JSON 或纯文本)</label>
              <textarea
                value={valueInput}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValueInput(e.target.value)}
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
