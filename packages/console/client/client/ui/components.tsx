import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatClock, useLocale } from './locale.js';

const cx = (...parts: readonly (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/** 包裹插件页面：提供 `zk-` 样式作用域（需另行注入 {@link pluginUiStyles}）。 */
export function PluginPage({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('zk-root', 'zk-page', className)}>{children}</div>;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'sm' | 'icon';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** 本按钮的操作进行中：原位显示转圈，并保持可读文案；不影响其他按钮。 */
  readonly busy?: boolean;
  readonly onClick?: () => unknown;
  readonly buttonRef?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', size = 'default', busy, disabled, onClick, buttonRef, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      ref={buttonRef}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick ? () => { void onClick(); } : undefined}
      className={cx('zk-btn', `zk-btn--${variant}`, size !== 'default' && `zk-btn--${size}`, className)}
    >
      {busy && <span className="zk-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** 状态徽标：状态必须由文字表达，颜色只是辅助。 */
export function Badge({ tone = 'neutral', children }: { readonly tone?: BadgeTone; readonly children: React.ReactNode }) {
  return <span className={cx('zk-badge', `zk-badge--${tone}`)}>{children}</span>;
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface NoticeProps {
  readonly tone?: NoticeTone;
  readonly title?: React.ReactNode;
  readonly children?: React.ReactNode;
  /** 提供后显示“关闭”按钮。错误提示不会自动消失，只能由用户关闭或问题解决。 */
  readonly onDismiss?: () => void;
  readonly actions?: React.ReactNode;
}

export function Notice({ tone = 'info', title, children, onDismiss, actions }: NoticeProps) {
  const { t } = useLocale();
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('zk-notice', `zk-notice--${tone}`)}>
      <div className="zk-notice__body">
        {title && <strong className="zk-notice__title">{title}</strong>}
        {children && <div>{children}</div>}
        {actions && <div className="zk-row">{actions}</div>}
      </div>
      {onDismiss && <Button variant="ghost" size="sm" onClick={onDismiss}>{t('关闭')}</Button>}
    </div>
  );
}

export function EmptyState({ title, description, icon, action }: {
  readonly title: React.ReactNode; readonly description?: React.ReactNode; readonly icon?: React.ReactNode; readonly action?: React.ReactNode;
}) {
  return (
    <div className="zk-empty">
      {icon && <span className="zk-empty__icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label, rows = 2 }: { readonly label?: string; readonly rows?: number }) {
  const { t } = useLocale();
  return (
    <div className="zk-loading" role="status" aria-busy="true">
      <p>{label ?? t('加载中…')}</p>
      {Array.from({ length: rows }, (_, index) => <span key={index} className="zk-loading__block" aria-hidden="true" />)}
    </div>
  );
}

export function ErrorState({ title, message, details, onRetry, retrying }: {
  readonly title?: React.ReactNode;
  /** 面向用户、可操作的说明（发生了什么、可以怎么办）。 */
  readonly message: React.ReactNode;
  /** 原始错误等技术信息，默认折叠。 */
  readonly details?: string;
  readonly onRetry?: () => unknown;
  readonly retrying?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div role="alert" className="zk-error">
      <strong>{title ?? t('加载失败')}</strong>
      <p>{message}</p>
      {details && <details><summary>{t('技术详情')}</summary><pre>{details}</pre></details>}
      {onRetry && <div><Button busy={retrying} onClick={onRetry}>{retrying ? t('重试中…') : t('重试')}</Button></div>}
    </div>
  );
}

/** 刷新失败但仍展示旧数据时的提示。 */
export function StaleNotice({ lastSuccessAt, error }: { readonly lastSuccessAt?: number; readonly error?: string }) {
  const { t } = useLocale();
  return (
    <Notice tone="warning">
      {lastSuccessAt === undefined ? t('数据可能已过期')
        : <>{t('数据可能已过期，上次成功 {0}', '')}<time dateTime={new Date(lastSuccessAt).toISOString()}>{formatClock(lastSuccessAt)}</time></>}
      {error && <div className="zk-hint">{t('最近一次刷新失败：{0}', error)}</div>}
    </Notice>
  );
}

export interface ConfirmButtonProps {
  readonly children: React.ReactNode;
  /** 行动明确的确认文案，如“删除账号”，不要用“确定”。 */
  readonly confirmLabel: string;
  readonly message: React.ReactNode;
  readonly onConfirm: () => unknown;
  /** 打开确认前的校验；返回 false 则不打开（例如必填项缺失）。 */
  readonly beforeOpen?: () => boolean | void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** 确认按钮是否用危险样式，默认 true。 */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly cancelLabel?: string;
}

/** 行内确认，替代 `window.confirm`：取消或 Esc 时焦点回到触发按钮。 */
export function ConfirmButton({ children, confirmLabel, message, onConfirm, beforeOpen, variant = 'secondary', size, danger = true, disabled, busy, cancelLabel }: ConfirmButtonProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
    else if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [open]);
  const close = useCallback(() => { returnFocus.current = true; setOpen(false); }, []);
  if (!open) {
    return <Button buttonRef={trigger} variant={variant} size={size} disabled={disabled} busy={busy}
      aria-expanded={false} onClick={() => { if (beforeOpen?.() === false) return; setOpen(true); }}>{children}</Button>;
  }
  return (
    <div role="group" aria-label={t('确认：{0}', confirmLabel)} className="zk-confirm"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <span className="zk-confirm__message">{message}</span>
      <Button buttonRef={confirmRef} variant={danger ? 'danger' : 'primary'} size={size} onClick={() => { close(); return onConfirm(); }}>{confirmLabel}</Button>
      <Button variant="ghost" size={size} onClick={close}>{cancelLabel ?? t('取消')}</Button>
    </div>
  );
}

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-required'?: true;
}

/** 表单字段：标签 + 说明 + 错误，并把 `aria-describedby` 接到控件上。 */
export function Field({ label, hint, error, required, children }: {
  readonly label: React.ReactNode;
  readonly hint?: React.ReactNode;
  readonly error?: React.ReactNode;
  readonly required?: boolean;
  /** 控件元素（自动注入 id / aria-*），或接收这些属性的渲染函数。 */
  readonly children: React.ReactElement | ((control: FieldControlProps) => React.ReactNode);
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control: FieldControlProps = { id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}), ...(required ? { 'aria-required': true as const } : {}) };
  return (
    <div className="zk-field">
      <label htmlFor={id} className="zk-field__label">{label}{required && <span className="zk-field__required" aria-hidden="true"> *</span>}</label>
      {typeof children === 'function' ? children(control) : React.cloneElement(children, control)}
      {hint && <span id={hintId} className="zk-hint">{hint}</span>}
      {error && <span id={errorId} className="zk-field__error">{error}</span>}
    </div>
  );
}

export function PageHeader({ title, description, mark, actions }: {
  readonly title: React.ReactNode; readonly description?: React.ReactNode; readonly mark?: React.ReactNode; readonly actions?: React.ReactNode;
}) {
  return (
    <header className="zk-page-header">
      <div className="zk-page-header__identity">
        {mark && <span className="zk-mark" aria-hidden="true">{mark}</span>}
        <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      </div>
      {actions && <div className="zk-row">{actions}</div>}
    </header>
  );
}

export function Section({ id, title, description, actions, children, ...rest }: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  readonly title?: React.ReactNode; readonly description?: React.ReactNode; readonly actions?: React.ReactNode;
}) {
  return (
    <section id={id} {...rest} className={cx('zk-section', rest.className)}>
      {(title || actions) && <div className="zk-section__head"><div>{title && <h2>{title}</h2>}{description && <p className="zk-hint">{description}</p>}</div>{actions}</div>}
      {children}
    </section>
  );
}
