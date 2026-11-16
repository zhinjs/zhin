import { useConsoleUiI18n } from '../i18n/index.js'
import { AlertCircle, RefreshCw, Info } from 'lucide-react'
import { CONSOLE_ICON_STROKE_WIDTH } from './icon.js'
import { Alert, AlertDescription } from './ui/alert.js'
import { Button } from './ui/button.js'

export type ErrorAlertKind = 'none' | '404' | '503' | 'other'

export interface ErrorAlertProps {
  error: string
  onRetry?: () => void
  className?: string
  kind?: ErrorAlertKind
  /** Raw error text kept behind a collapsible "技术详情" disclosure. */
  technicalDetail?: string
}

function variantForKind(kind: ErrorAlertKind): 'destructive' | 'warning' | 'default' {
  if (kind === '503') return 'warning'
  if (kind === '404') return 'default'
  return 'destructive'
}

/**
 * 统一错误提示组件
 * - 标准化 Alert 样式 + 可选重试按钮
 * - 404 / 503 使用差异化样式
 */
export function ErrorAlert({ error, onRetry, className, kind = 'other', technicalDetail }: ErrorAlertProps) {
  const i18n = useConsoleUiI18n()
  const Icon = kind === '404' ? Info : AlertCircle
  return (
    <Alert variant={variantForKind(kind)} className={className}>
      <Icon strokeWidth={CONSOLE_ICON_STROKE_WIDTH} className="size-4" />
      <AlertDescription className="space-y-2">
       <div className="flex items-center justify-between gap-2">
        <span>{error}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
            <RefreshCw strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" />
            {i18n.t("error.retry")}</Button>
        )}
       </div>
        {technicalDetail ? (
          <details className="text-label">
            <summary className="min-h-touch-min cursor-pointer">{i18n.t("error.technicalDetail")}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{technicalDetail}</pre>
          </details>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
