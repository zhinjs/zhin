import { useState, useCallback } from 'react'
import { cn } from '@zhin.js/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { setToken } from '../utils/auth'

interface LoginPageProps {
  onSuccess: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = useCallback(async () => {
    const trimmed = token.trim()
    if (!trimmed) {
      setError('请输入 Token')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/system/status', {
        headers: { Authorization: `Bearer ${trimmed}` },
      })

      if (res.ok) {
        setToken(trimmed)
        onSuccess()
      } else if (res.status === 401) {
        setError('Token 无效，请检查后重试')
      } else {
        setError(`验证失败 (HTTP ${res.status})`)
      }
    } catch {
      setError('无法连接到服务器')
    } finally {
      setLoading(false)
    }
  }, [token, onSuccess])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className={cn('w-full max-w-md mx-4')}>
        <CardHeader className="text-center space-y-2">
          <div className="flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-foreground text-background font-bold text-xl">
            Z
          </div>
          <CardTitle className="text-xl">Zhin.js 控制台</CardTitle>
          <CardDescription>
            请输入 API Token 以访问管理面板
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
              {loading ? '验证中...' : '登录'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Token 位于 <code className="text-xs bg-muted px-1 rounded">.env</code> 文件的{' '}
              <code className="text-xs bg-muted px-1 rounded">HTTP_TOKEN</code> 中
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
