import { useState, useCallback } from 'react'
import { cn } from '@zhin.js/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { setToken, setApiBase, getApiBase } from '../utils/auth'

interface LoginPageProps {
  onSuccess: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [apiBase, setApiBaseValue] = useState(() => {
    const stored = getApiBase()
    if (stored && stored !== window.location.origin) return stored
    return 'http://localhost:8086'
  })
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = useCallback(async () => {
    const trimmed = token.trim()
    const base = apiBase.trim().replace(/\/$/, '')
    if (!base) {
      setError('请填写 API Base URL（如 http://localhost:8086）')
      return
    }
    if (!trimmed) {
      setError('请输入 Token')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${base}/api/system/status`, {
        headers: { Authorization: `Bearer ${trimmed}` },
      })

      if (res.ok) {
        setApiBase(base)
        setToken(trimmed)
        onSuccess()
      } else if (res.status === 401) {
        setError('Token 无效，请检查后重试')
      } else {
        setError(`验证失败 (HTTP ${res.status})`)
      }
    } catch {
      setError('无法连接到 API，请检查 Base URL 与网络')
    } finally {
      setLoading(false)
    }
  }, [token, apiBase, onSuccess])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className={cn('w-full max-w-md mx-4')}>
        <CardHeader className="text-center space-y-2">
          <div className="flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-foreground text-background font-bold text-xl">
            Z
          </div>
          <CardTitle className="text-xl">Zhin.js 控制台</CardTitle>
          <CardDescription>
            配置 Remote Console：API 地址与 Bearer Token
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleLogin()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Input
                type="url"
                placeholder="API Base URL（如 http://127.0.0.1:8086）"
                value={apiBase}
                onChange={(e) => setApiBaseValue(e.target.value)}
              />
              <Input
                type="password"
                placeholder="API Token"
                value={token}
                onChange={(e) => {
                  setTokenValue(e.target.value)
                  if (error) setError('')
                }}
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '验证中...' : '连接'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              须填写运行 test-bot 的 Host 地址（与预览站 5173 不同）。localhost 与 127.0.0.1 请与 corsOrigins 一致。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
