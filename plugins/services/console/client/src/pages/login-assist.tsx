import { useEffect, useState, useCallback } from 'react'
import { LogIn, QrCode, MessageSquare, MousePointer, Smartphone, AlertCircle } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'

interface PendingLoginTask {
  id: string
  adapter: string
  botId: string
  type: string
  payload?: {
    message?: string
    image?: string
    url?: string
    [key: string]: unknown
  }
  createdAt: number
}

const POLL_INTERVAL_MS = 2000

export default function LoginAssistPage() {
  const [pending, setPending] = useState<PendingLoginTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [inputValues, setInputValues] = useState<Record<string, string>>({})

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch('/api/login-assist/pending')
      if (!res.ok) throw new Error('获取待办失败')
      const data = await res.json()
      setPending(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPending()
    const interval = setInterval(fetchPending, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchPending])

  const handleSubmit = async (id: string, value: string | Record<string, unknown>) => {
    setSubmitting((s) => ({ ...s, [id]: true }))
    try {
      const res = await apiFetch('/api/login-assist/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value }),
      })
      if (!res.ok) throw new Error('提交失败')
      setInputValues((v) => {
        const next = { ...v }
        delete next[id]
        return next
      })
      await fetchPending()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting((s) => ({ ...s, [id]: false }))
    }
  }

  const handleCancel = async (id: string) => {
    try {
      const res = await apiFetch('/api/login-assist/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) await fetchPending()
    } catch {
      // ignore
    }
  }

  const typeIcon: Record<string, React.ReactNode> = {
    qrcode: <QrCode className="w-4 h-4" />,
    sms: <MessageSquare className="w-4 h-4" />,
    device: <Smartphone className="w-4 h-4" />,
    slider: <MousePointer className="w-4 h-4" />,
  }
  const typeLabel: Record<string, string> = {
    qrcode: '扫码登录',
    sms: '短信验证码',
    device: '设备验证',
    slider: '滑块验证',
    other: '其他',
  }

  if (loading && pending.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">登录辅助</h1>
        <p className="text-sm text-muted-foreground mt-1">
          需要人为辅助登录的待办会出现在下方，在 Web 完成操作或刷新页面后仍可继续处理。
        </p>
      </div>

      <Separator />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <LogIn className="w-16 h-16 text-muted-foreground/30" />
            <div className="text-center">
              <h3 className="text-lg font-semibold">暂无待办</h3>
              <p className="text-sm text-muted-foreground">当有机器人需要扫码、短信或滑块验证时，待办会显示在这里</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pending.map((task) => (
            <Card key={task.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="shrink-0">{typeIcon[task.type] ?? <LogIn className="w-4 h-4" />}</span>
                    {typeLabel[task.type] ?? task.type}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{task.adapter}</Badge>
                    <Badge variant="secondary">{task.botId}</Badge>
                  </div>
                </div>
                {task.payload?.message && (
                  <p className="text-sm text-muted-foreground mt-1">{task.payload.message}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {task.type === 'qrcode' && task.payload?.image && (
                  <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
                    <img
                      src={task.payload.image}
                      alt="登录二维码"
                      className="max-w-[200px] w-full h-auto"
                    />
                  </div>
                )}
                {task.type === 'slider' && task.payload?.url && (
                  <p className="text-sm break-all">
                    <span className="text-muted-foreground">滑块链接：</span>{' '}
                    <a href={task.payload.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      {task.payload.url}
                    </a>
                  </p>
                )}
                {(task.type === 'sms' || task.type === 'device' || task.type === 'slider') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder={task.type === 'slider' ? '输入 ticket' : '输入验证码'}
                      className="max-w-xs"
                      value={inputValues[task.id] ?? ''}
                      onChange={(e) => setInputValues((v) => ({ ...v, [task.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = inputValues[task.id]?.trim()
                          if (val) handleSubmit(task.id, task.type === 'slider' ? { ticket: val } : val)
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      disabled={submitting[task.id] || !(inputValues[task.id]?.trim())}
                      onClick={() => {
                        const val = inputValues[task.id]?.trim()
                        if (val) handleSubmit(task.id, task.type === 'slider' ? { ticket: val } : val)
                      }}
                    >
                      {submitting[task.id] ? '提交中…' : '提交'}
                    </Button>
                  </div>
                )}
                {task.type === 'qrcode' && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={submitting[task.id]}
                      onClick={() => handleSubmit(task.id, { done: true })}
                    >
                      {submitting[task.id] ? '提交中…' : '我已扫码'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleCancel(task.id)}>
                      取消
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
