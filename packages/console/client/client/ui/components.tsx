import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatClock, useLocale } from './locale.js';

const cx = (...parts: readonly (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/** 包裹插件页面：提供 `zk-` 样式作用域（需另行注入 {@link pluginUiStyles}）。 */
export function PluginPage({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('zk-root', 'zk-page', className)}>{children}</div>;
}

export type UiSize = 'sm' | 'md' | 'lg' | 'default';
export type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';
export type ButtonSize = 'default' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: React.ReactNode;
  readonly trailingIcon?: React.ReactNode;
  /** 本按钮的操作进行中：原位显示转圈，并保持可读文案；不影响其他按钮。 */
  readonly busy?: boolean;
  readonly onClick?: () => unknown;
  readonly buttonRef?: React.Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'default',
  icon,
  trailingIcon,
  busy,
  disabled,
  onClick,
  buttonRef,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const normalizedSize = size === 'md' ? 'default' : size;
  return (
    <button
      {...rest}
      ref={buttonRef}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick ? () => { void onClick(); } : undefined}
      className={cx('zk-btn', `zk-btn--${variant}`, normalizedSize !== 'default' && `zk-btn--${normalizedSize}`, className)}
    >
      {busy ? <span className="zk-spinner" aria-hidden="true" /> : icon}
      {children}
      {trailingIcon}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** 状态徽标：状态必须由文字表达，颜色只是辅助。支持自定义图标与尺寸规范。 */
export function Badge({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
}: {
  readonly tone?: BadgeTone;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        'zk-badge',
        `zk-badge--${tone}`,
        size !== 'md' && `zk-badge--${size}`,
        Boolean(icon) && 'zk-badge--has-icon',
      )}
    >
      {icon}
      {children}
    </span>
  );
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

/* ============================================================================
 * 1. Layout & Surface Components (Card, Grid, Stack, SplitView, Divider)
 * ========================================================================== */

export type CardTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title?: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly tone?: CardTone;
  readonly compact?: boolean;
  readonly interactive?: boolean;
}

export function Card({
  title,
  subtitle,
  badge,
  actions,
  footer,
  tone = 'default',
  compact,
  interactive,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={cx(
        'zk-card',
        tone !== 'default' && `zk-card--${tone}`,
        compact && 'zk-card--compact',
        interactive && 'zk-card--interactive',
        className,
      )}
    >
      {(title || subtitle || badge || actions) && (
        <div className="zk-card__head">
          <div className="zk-card__title-group">
            {(title || badge) && (
              <div className="zk-card__title">
                {title}
                {badge}
              </div>
            )}
            {subtitle && <div className="zk-card__subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="zk-row">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="zk-card__footer">{footer}</div>}
    </div>
  );
}

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly cols?: number;
  readonly minItemWidth?: number | string;
  readonly gap?: number | string;
}

export function Grid({ cols, minItemWidth = 240, gap = 16, style, className, children, ...rest }: GridProps) {
  const minW = typeof minItemWidth === 'number' ? `${minItemWidth}px` : minItemWidth;
  const gapVal = typeof gap === 'number' ? `${gap}px` : gap;
  return (
    <div
      {...rest}
      style={{
        ...(cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : { '--zk-grid-min': minW } as React.CSSProperties),
        '--zk-grid-gap': gapVal,
        ...style,
      } as React.CSSProperties}
      className={cx('zk-grid', className)}
    >
      {children}
    </div>
  );
}

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly direction?: 'column' | 'row';
  readonly gap?: number | string;
  readonly align?: React.CSSProperties['alignItems'];
  readonly justify?: React.CSSProperties['justifyContent'];
  readonly wrap?: boolean;
}

export function Stack({
  direction = 'column',
  gap = 12,
  align,
  justify,
  wrap,
  style,
  className,
  children,
  ...rest
}: StackProps) {
  const gapVal = typeof gap === 'number' ? `${gap}px` : gap;
  return (
    <div
      {...rest}
      style={{
        gap: gapVal,
        ...(align ? { alignItems: align } : {}),
        ...(justify ? { justifyContent: justify } : {}),
        ...(wrap === false ? { flexWrap: 'nowrap' } : {}),
        ...style,
      }}
      className={cx(direction === 'row' ? 'zk-row' : 'zk-stack', className)}
    >
      {children}
    </div>
  );
}

export interface SplitViewProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly sidebar?: React.ReactNode;
  readonly sidebarWidth?: number | string;
}

export function SplitView({ sidebar, sidebarWidth = 300, style, className, children, ...rest }: SplitViewProps) {
  const w = typeof sidebarWidth === 'number' ? `${sidebarWidth}px` : sidebarWidth;
  return (
    <div
      {...rest}
      style={{ '--zk-sidebar-w': w, ...style } as React.CSSProperties}
      className={cx('zk-split', !sidebar && 'zk-split--single', className)}
    >
      <div className="zk-stack">{children}</div>
      {sidebar && <aside className="zk-stack">{sidebar}</aside>}
    </div>
  );
}

export function Divider({ label, dashed, className }: {
  readonly label?: React.ReactNode;
  readonly dashed?: boolean;
  readonly className?: string;
}) {
  if (label) {
    return <div role="separator" className={cx('zk-divider-label', className)}>{label}</div>;
  }
  return <hr className={cx('zk-divider', dashed && 'zk-divider--dashed', className)} />;
}

/* ============================================================================
 * 2. Navigation & Disclosure (Tabs, SegmentedControl, Collapsible, FilterBar)
 * ========================================================================== */

export interface TabItem {
  readonly key: string;
  readonly label: React.ReactNode;
  readonly badge?: React.ReactNode | number;
  readonly icon?: React.ReactNode;
  readonly disabled?: boolean;
  readonly content?: React.ReactNode;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (key: string) => void;
  readonly variant?: 'underline' | 'pills' | 'segmented';
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  variant = 'underline',
  ariaLabel,
  className,
}: TabsProps) {
  const baseId = useId();
  const firstEnabled = items.find((i) => !i.disabled)?.key ?? items[0]?.key ?? '';
  const [internal, setInternal] = useState<string>(defaultValue ?? firstEnabled);
  const activeKey = value !== undefined ? value : internal;
  const select = useCallback((nextKey: string) => {
    if (value === undefined) setInternal(nextKey);
    onChange?.(nextKey);
  }, [value, onChange]);

  const enabledKeys = useMemo(() => items.filter((i) => !i.disabled).map((i) => i.key), [items]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (enabledKeys.length <= 1) return;
    const idx = enabledKeys.indexOf(activeKey);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      select(enabledKeys[(idx + 1) % enabledKeys.length]!);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      select(enabledKeys[(idx - 1 + enabledKeys.length) % enabledKeys.length]!);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(enabledKeys[0]!);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(enabledKeys[enabledKeys.length - 1]!);
    }
  };

  const activeItem = items.find((i) => i.key === activeKey) ?? items[0];

  return (
    <div className={cx('zk-tabs', className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cx('zk-tablist', variant !== 'underline' && `zk-tablist--${variant}`)}
      >
        {items.map((item) => {
          const selected = item.key === activeItem?.key;
          return (
            <button
              key={item.key}
              id={`${baseId}-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.key)}
              className="zk-tab"
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && <span className="zk-count">{item.badge}</span>}
            </button>
          );
        })}
      </div>
      {activeItem?.content !== undefined && (
        <div
          id={`${baseId}-panel-${activeItem.key}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeItem.key}`}
          className="zk-tabpanel"
        >
          {activeItem.content}
        </div>
      )}
    </div>
  );
}

export interface SegmentedOption<T extends string = string> {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode | number;
  readonly disabled?: boolean;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}) {
  return (
    <Tabs
      variant="segmented"
      ariaLabel={ariaLabel}
      className={className}
      value={value}
      onChange={(next) => onChange(next as T)}
      items={options.map((opt) => ({
        key: opt.value,
        label: opt.label,
        icon: opt.icon,
        badge: opt.badge,
        disabled: opt.disabled,
      }))}
    />
  );
}

export interface CollapsibleProps {
  readonly title: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function Collapsible({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const panelId = useId();
  const toggle = () => {
    const next = !isOpen;
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <div data-open={isOpen ? 'true' : 'false'} className={cx('zk-collapsible', className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
        className="zk-collapsible__trigger"
      >
        <span className="zk-row">
          <span className="zk-collapsible__chevron" aria-hidden="true">▸</span>
          <span>{title}</span>
          {badge}
          {subtitle && <span className="zk-hint">{subtitle}</span>}
        </span>
      </button>
      {isOpen && (
        <div id={panelId} className="zk-collapsible__body">
          {children}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 3. Form Controls (Input, Textarea, Select, Switch, Checkbox, CheckboxGroup, RadioGroup)
 * ========================================================================== */

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  readonly prefix?: React.ReactNode;
  readonly suffix?: React.ReactNode;
  readonly clearable?: boolean;
  readonly onClear?: () => void;
  readonly size?: UiSize;
  readonly monospace?: boolean;
}

export function Input({
  prefix,
  suffix,
  clearable,
  onClear,
  size = 'default',
  monospace,
  className,
  value,
  onChange,
  ...rest
}: InputProps) {
  const { t } = useLocale();
  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  const showClear = Boolean(clearable && hasValue && !rest.disabled && !rest.readOnly);
  const effectiveSuffix = showClear ? (
    <button
      type="button"
      aria-label={t('清空')}
      onClick={() => {
        onClear?.();
        if (onChange) {
          onChange({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);
        }
      }}
      className="zk-tag__remove"
    >
      ×
    </button>
  ) : suffix;
  const sizeCls = size === 'sm' ? 'zk-input--sm' : size === 'lg' ? 'zk-input--lg' : false;

  if (!prefix && !effectiveSuffix) {
    return (
      <input
        {...rest}
        value={value}
        onChange={onChange}
        className={cx(sizeCls, monospace && 'zk-input--mono', className)}
      />
    );
  }
  return (
    <div
      className={cx(
        'zk-input-wrap',
        Boolean(prefix) && 'zk-input-wrap--has-prefix',
        Boolean(effectiveSuffix) && 'zk-input-wrap--has-suffix',
        className,
      )}
    >
      {prefix && <span className="zk-input-wrap__prefix" aria-hidden="true">{prefix}</span>}
      <input
        {...rest}
        value={value}
        onChange={onChange}
        className={cx(sizeCls, monospace && 'zk-input--mono')}
      />
      {effectiveSuffix && <span className="zk-input-wrap__suffix">{effectiveSuffix}</span>}
    </div>
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly monospace?: boolean;
  readonly showCount?: boolean;
}

export function Textarea({ monospace, showCount, maxLength, value, className, ...rest }: TextareaProps) {
  const len = value !== undefined && value !== null ? String(value).length : 0;
  return (
    <div className="zk-field">
      <textarea
        {...rest}
        maxLength={maxLength}
        value={value}
        className={cx(monospace && 'zk-input--mono', className)}
      />
      {showCount && (
        <span className="zk-hint" style={{ justifySelf: 'end' }}>
          {maxLength ? `${len} / ${maxLength}` : `${len}`}
        </span>
      )}
    </div>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'onChange'> {
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly size?: UiSize;
  readonly onValueChange?: (value: string) => void;
  readonly onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}

export function Select({
  options,
  placeholder,
  size = 'default',
  onValueChange,
  onChange,
  className,
  ...rest
}: SelectProps) {
  const sizeCls = size === 'sm' ? 'zk-input--sm' : size === 'lg' ? 'zk-input--lg' : false;
  return (
    <select
      {...rest}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      className={cx(sizeCls, className)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly disabled?: boolean;
  readonly size?: UiSize;
  readonly id?: string;
  readonly ariaLabel?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  size = 'default',
  id,
  ariaLabel,
}: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };
  return (
    <div
      aria-disabled={disabled || undefined}
      onClick={toggle}
      className="zk-switch-row"
    >
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={cx('zk-switch', size === 'sm' && 'zk-switch--sm', size === 'lg' && 'zk-switch--lg')}
      >
        <span className="zk-switch__thumb" aria-hidden="true" />
      </button>
      {icon && <span className="zk-check-icon" aria-hidden="true">{icon}</span>}
      {(label || description) && (
        <div className="zk-control-text">
          {label && <span className="zk-control-text__label">{label}</span>}
          {description && <span className="zk-control-text__desc">{description}</span>}
        </div>
      )}
    </div>
  );
}

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly indeterminate?: boolean;
  readonly variant?: 'default' | 'card';
  readonly disabled?: boolean;
  readonly id?: string;
  readonly ariaLabel?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  icon,
  badge,
  indeterminate,
  variant = 'default',
  disabled,
  id,
  ariaLabel,
}: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);
  return (
    <label
      htmlFor={inputId}
      aria-disabled={disabled || undefined}
      data-checked={checked ? 'true' : 'false'}
      className={cx('zk-check-row', variant === 'card' && 'zk-check-card')}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="checkbox"
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {icon && <span className="zk-check-icon" aria-hidden="true">{icon}</span>}
      {(label || description || badge) && (
        <span className="zk-control-text">
          {(label || badge) && (
            <span className="zk-control-text__label">
              {label}
              {badge}
            </span>
          )}
          {description && <span className="zk-control-text__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

export interface CheckboxOption<T extends string = string> {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly disabled?: boolean;
}

export function CheckboxGroup<T extends string = string>({
  options,
  value,
  onChange,
  direction = 'column',
  variant = 'default',
  ariaLabel,
}: {
  readonly options: readonly CheckboxOption<T>[];
  readonly value: readonly T[];
  readonly onChange: (value: T[]) => void;
  readonly direction?: 'column' | 'row' | 'grid';
  readonly variant?: 'default' | 'card';
  readonly ariaLabel?: string;
}) {
  const selectedSet = useMemo(() => new Set<T>(value), [value]);
  const toggleValue = (itemValue: T, nextChecked: boolean) => {
    const next = new Set<T>(selectedSet);
    if (nextChecked) next.add(itemValue);
    else next.delete(itemValue);
    onChange(options.map((opt) => opt.value).filter((v) => next.has(v)));
  };
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx(
        'zk-check-group',
        direction === 'row' && 'zk-check-group--row',
        direction === 'grid' && 'zk-check-group--grid',
      )}
    >
      {options.map((opt) => (
        <Checkbox
          key={opt.value}
          checked={selectedSet.has(opt.value)}
          disabled={opt.disabled}
          label={opt.label}
          description={opt.description}
          icon={opt.icon}
          badge={opt.badge}
          variant={variant}
          onChange={(nextChecked) => toggleValue(opt.value, nextChecked)}
        />
      ))}
    </div>
  );
}

export interface RadioOption<T extends string = string> {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly disabled?: boolean;
}

export function RadioGroup<T extends string = string>({
  options,
  value,
  onChange,
  direction = 'column',
  variant = 'default',
  name,
  ariaLabel,
}: {
  readonly options: readonly RadioOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly direction?: 'column' | 'row' | 'grid';
  readonly variant?: 'default' | 'card' | 'button';
  readonly name?: string;
  readonly ariaLabel?: string;
}) {
  const groupName = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        'zk-radio-group',
        direction === 'row' && 'zk-radio-group--row',
        direction === 'grid' && 'zk-radio-group--grid',
        variant === 'button' && 'zk-radio-group--button',
      )}
    >
      {options.map((opt) => {
        const checked = value === opt.value;
        if (variant === 'button') {
          return (
            <label
              key={opt.value}
              aria-disabled={opt.disabled || undefined}
              data-checked={checked ? 'true' : 'false'}
              className="zk-radio-btn"
            >
              <input
                type="radio"
                name={name ?? groupName}
                value={opt.value}
                checked={checked}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
              />
              {opt.icon && <span className="zk-check-icon" aria-hidden="true">{opt.icon}</span>}
              <span>{opt.label}</span>
              {opt.badge}
            </label>
          );
        }
        return (
          <label
            key={opt.value}
            aria-disabled={opt.disabled || undefined}
            data-checked={checked ? 'true' : 'false'}
            className={cx('zk-check-row', variant === 'card' && 'zk-check-card')}
          >
            <input
              type="radio"
              name={name ?? groupName}
              value={opt.value}
              checked={checked}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
            />
            {opt.icon && <span className="zk-check-icon" aria-hidden="true">{opt.icon}</span>}
            <span className="zk-control-text">
              <span className="zk-control-text__label">
                {opt.label}
                {opt.badge}
              </span>
              {opt.description && <span className="zk-control-text__desc">{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * 4. Data Display & Visualization
 *    (ProgressBar, RingProgress, Sparkline, StatCard, StatGrid,
 *     DescriptionList, Timeline, CodeBlock, JsonView, CopyButton,
 *     Avatar, StatusDot, Tag, Kbd, Skeleton)
 * ========================================================================== */

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly label?: React.ReactNode;
  readonly showValue?: boolean;
  readonly striped?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
  size = 'md',
  label,
  showValue = false,
  striped = false,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, (value / safeMax) * 100)) : 0;
  const autoTone =
    tone === 'primary' && pct >= 90 ? 'danger' : tone === 'primary' && pct >= 75 ? 'warning' : tone;
  return (
    <div className="zk-progress-wrap">
      {(label || showValue) && (
        <div className="zk-progress-head">
          <span>{label}</span>
          {showValue && <span>{`${Math.round(pct)}%`}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cx(
          'zk-progress',
          size !== 'md' && `zk-progress--${size}`,
          autoTone !== 'primary' && `zk-progress--${autoTone}`,
          striped && 'zk-progress--striped',
        )}
      >
        <div className="zk-progress__bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface RingProgressProps {
  readonly value: number;
  readonly max?: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  readonly label?: React.ReactNode;
  readonly sublabel?: React.ReactNode;
  readonly centerText?: React.ReactNode;
  /** 环形图中心自定义图片 URL（如平台图标、Avatar 等）。 */
  readonly centerImage?: string;
  /** 环形图中心自定义图标节点。 */
  readonly centerIcon?: React.ReactNode;
}

export function RingProgress({
  value,
  max = 100,
  size = 64,
  strokeWidth = 6,
  tone = 'primary',
  label,
  sublabel,
  centerText,
  centerImage,
  centerIcon,
}: RingProgressProps) {
  const safeMax = max > 0 ? max : 100;
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, (value / safeMax) * 100)) : 0;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const colorVar =
    tone === 'success'
      ? 'var(--zk-success)'
      : tone === 'warning'
        ? 'var(--zk-warning)'
        : tone === 'danger'
          ? 'var(--zk-danger)'
          : tone === 'info'
            ? 'var(--zk-info)'
            : 'var(--zk-primary)';
  return (
    <div className="zk-ring-progress">
      <div className="zk-ring-progress__svg-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--zk-inset)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={colorVar}
            strokeWidth={strokeWidth}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="zk-ring-progress__center">
          {centerImage ? (
            <img src={centerImage} alt="" className="zk-ring-progress__img" />
          ) : centerIcon !== undefined ? (
            centerIcon
          ) : centerText !== undefined ? (
            centerText
          ) : (
            `${Math.round(pct)}%`
          )}
        </span>
      </div>
      {(label || sublabel) && (
        <div className="zk-ring-progress__meta">
          {label && <strong style={{ fontSize: 'var(--zk-text-small)' }}>{label}</strong>}
          {sublabel && <span className="zk-hint">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}

export interface SparklineProps {
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  readonly fillArea?: boolean;
  /** 趋势线终点或峰值处自定义图片标记 URL。 */
  readonly markerImage?: string;
  readonly showPeak?: boolean;
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  tone = 'primary',
  fillArea = true,
  markerImage,
  showPeak = false,
}: SparklineProps) {
  const gradId = useId();
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) {
    return <span style={{ display: 'inline-block', width, height }} aria-hidden="true" />;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const pad = markerImage ? 7 : 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const yOf = (v: number) =>
    min === max ? pad + innerH / 2 : pad + innerH - ((v - min) / (max - min)) * innerH;
  const coords = finite.map((v, idx) => ({
    x: pad + (idx / (finite.length - 1)) * innerW,
    y: yOf(v),
    v,
  }));
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPoints = `${coords[0]!.x.toFixed(1)},${height - pad} ${points} ${coords[coords.length - 1]!.x.toFixed(1)},${height - pad}`;
  const colorVar =
    tone === 'success'
      ? 'var(--zk-success)'
      : tone === 'warning'
        ? 'var(--zk-warning)'
        : tone === 'danger'
          ? 'var(--zk-danger)'
          : tone === 'info'
            ? 'var(--zk-info)'
            : 'var(--zk-primary)';
  const last = coords[coords.length - 1]!;
  const peak = showPeak ? coords.reduce((best, cur) => (cur.v > best.v ? cur : best), coords[0]!) : undefined;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {fillArea && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorVar} stopOpacity="0.24" />
              <stop offset="100%" stopColor={colorVar} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#${gradId})`} />
        </>
      )}
      <polyline
        points={points}
        fill="none"
        stroke={colorVar}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {peak && peak !== last && (
        <circle cx={peak.x} cy={peak.y} r="2.5" fill="var(--zk-warning)" />
      )}
      {markerImage ? (
        <image
          href={markerImage}
          x={last.x - 6}
          y={last.y - 6}
          width="12"
          height="12"
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <circle cx={last.x} cy={last.y} r="2.75" fill={colorVar} />
      )}
    </svg>
  );
}

export interface BarChartItem {
  readonly label: React.ReactNode;
  readonly value: number;
  readonly icon?: React.ReactNode;
  /** 柱条顶部或底部关联的自定义图片 URL（如适配器图标、用户头像）。 */
  readonly image?: string;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

export interface BarChartProps {
  readonly items: readonly BarChartItem[];
  readonly height?: number;
  readonly max?: number;
  readonly showValues?: boolean;
  /** 图表背景自定义纹理或水印图片 URL。 */
  readonly backgroundImage?: string;
  readonly className?: string;
}

export function BarChart({
  items,
  height = 136,
  max,
  showValues = true,
  backgroundImage,
  className,
}: BarChartProps) {
  const computedMax = useMemo(() => {
    if (typeof max === 'number' && max > 0) return max;
    const m = Math.max(0, ...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)));
    return m > 0 ? m : 100;
  }, [items, max]);
  const trackHeight = Math.max(48, height - 46);
  return (
    <div className={cx('zk-bar-chart', className)}>
      {backgroundImage && <img src={backgroundImage} alt="" aria-hidden="true" className="zk-bar-chart__bg" />}
      <div className="zk-bar-chart__bars">
        {items.map((item, idx) => {
          const safeVal = Number.isFinite(item.value) ? Math.max(0, item.value) : 0;
          const pct = Math.min(100, Math.round((safeVal / computedMax) * 100));
          return (
            <div key={idx} className="zk-bar-chart__col">
              {showValues && <span className="zk-bar-chart__val">{safeVal}</span>}
              {item.image && <img src={item.image} alt="" className="zk-bar-chart__img" />}
              <div className="zk-bar-chart__track" style={{ height: trackHeight }}>
                <div
                  className={cx('zk-bar-chart__bar', item.tone && item.tone !== 'primary' && `zk-bar-chart__bar--${item.tone}`)}
                  style={{ height: `${Math.max(4, pct)}%` }}
                />
              </div>
              <span className="zk-bar-chart__label">
                {item.icon}
                <span>{item.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface DonutChartSegment {
  readonly label: React.ReactNode;
  readonly value: number;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  readonly color?: string;
  readonly icon?: React.ReactNode;
  /** 图例项自定义图片 URL。 */
  readonly image?: string;
}

export interface DonutChartProps {
  readonly segments: readonly DonutChartSegment[];
  readonly size?: number;
  readonly thickness?: number;
  /** 甜甜圈中心自定义图片 URL。 */
  readonly centerImage?: string;
  /** 甜甜圈中心自定义图标。 */
  readonly centerIcon?: React.ReactNode;
  readonly centerValue?: React.ReactNode;
  readonly centerLabel?: React.ReactNode;
  readonly showLegend?: boolean;
  readonly className?: string;
}

const TONE_COLOR_MAP: Record<string, string> = {
  primary: 'var(--zk-primary)',
  success: 'var(--zk-success)',
  warning: 'var(--zk-warning)',
  danger: 'var(--zk-danger)',
  info: 'var(--zk-info)',
  neutral: 'var(--zk-muted)',
};

const FALLBACK_PALETTE = [
  'var(--zk-primary)',
  'var(--zk-info)',
  'var(--zk-success)',
  'var(--zk-warning)',
  'var(--zk-danger)',
];

export function DonutChart({
  segments,
  size = 112,
  thickness = 12,
  centerImage,
  centerIcon,
  centerValue,
  centerLabel,
  showLegend = true,
  className,
}: DonutChartProps) {
  const total = segments.reduce((acc, s) => acc + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let accumulated = 0;

  return (
    <div className={cx('zk-donut-chart', className)}>
      <div className="zk-ring-progress__svg-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--zk-inset)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            segments.map((seg, idx) => {
              const val = Number.isFinite(seg.value) && seg.value > 0 ? seg.value : 0;
              const segLen = (val / total) * circumference;
              const dashOffset = -accumulated;
              accumulated += segLen;
              const stroke = seg.color ?? (seg.tone ? TONE_COLOR_MAP[seg.tone] : undefined) ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length]!;
              return (
                <circle
                  key={idx}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={thickness}
                  strokeDasharray={`${segLen} ${Math.max(0, circumference - segLen)}`}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
        </svg>
        <span className="zk-ring-progress__center">
          {centerImage ? (
            <img src={centerImage} alt="" className="zk-ring-progress__img" />
          ) : centerIcon !== undefined ? (
            centerIcon
          ) : (
            <span style={{ display: 'grid', justifyItems: 'center', lineHeight: 1.15 }}>
              <strong>{centerValue !== undefined ? centerValue : total}</strong>
              {centerLabel && <span style={{ fontSize: 10, color: 'var(--zk-muted)', fontWeight: 500 }}>{centerLabel}</span>}
            </span>
          )}
        </span>
      </div>
      {showLegend && segments.length > 0 && (
        <div className="zk-donut-chart__legend">
          {segments.map((seg, idx) => {
            const stroke = seg.color ?? (seg.tone ? TONE_COLOR_MAP[seg.tone] : undefined) ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length]!;
            return (
              <div key={idx} className="zk-donut-chart__item">
                <span className="zk-donut-chart__item-label">
                  <span className="zk-donut-chart__swatch" style={{ background: stroke }} aria-hidden="true" />
                  {seg.image && <img src={seg.image} alt="" className="zk-donut-chart__item-img" />}
                  {seg.icon}
                  <span>{seg.label}</span>
                </span>
                <span className="zk-donut-chart__item-val">{seg.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface StatCardProps {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly unit?: React.ReactNode;
  readonly hint?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly icon?: React.ReactNode;
  /** 标题旁自定义小图标图片 URL。 */
  readonly image?: string;
  /** 卡片右下角半透明水印（可传自定义图片 URL 或节点）。 */
  readonly watermark?: React.ReactNode | string;
  readonly tone?: BadgeTone | 'primary';
  readonly trend?: {
    readonly value: React.ReactNode;
    readonly direction?: 'up' | 'down' | 'flat';
  };
  readonly progress?: number;
  readonly sparkline?: readonly number[];
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  badge,
  icon,
  image,
  watermark,
  tone = 'primary',
  trend,
  progress,
  sparkline,
}: StatCardProps) {
  const trendTone: BadgeTone =
    trend?.direction === 'up' ? 'success' : trend?.direction === 'down' ? 'danger' : 'neutral';
  const trendArrow =
    trend?.direction === 'up' ? '↑ ' : trend?.direction === 'down' ? '↓ ' : '';
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }} className={cx('zk-stat-card', tone !== 'primary' && `zk-stat-card--${tone}`)}>
      {watermark && (
        <span className="zk-stat-watermark" aria-hidden="true">
          {typeof watermark === 'string' && (watermark.startsWith('http') || watermark.startsWith('/') || watermark.startsWith('data:')) ? (
            <img src={watermark} alt="" />
          ) : (
            watermark
          )}
        </span>
      )}
      <div className="zk-stat-card__head">
        <span className="zk-stat-card__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {image && <img src={image} alt="" className="zk-stat-icon-img" />}
          {icon && <span>{icon}</span>}
          {label}
        </span>
        {badge}
      </div>
      <div className="zk-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="zk-stat-card__value">
          {value}
          {unit && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-muted)', marginLeft: 4 }}>{unit}</span>}
        </div>
        {trend && (
          <Badge tone={trendTone}>
            {trendArrow}
            {trend.value}
          </Badge>
        )}
        {sparkline && sparkline.length >= 2 && (
          <Sparkline
            values={sparkline}
            width={88}
            height={26}
            tone={tone === 'neutral' ? 'primary' : tone}
          />
        )}
      </div>
      {typeof progress === 'number' && Number.isFinite(progress) && (
        <ProgressBar
          value={progress}
          size="sm"
          tone={tone === 'neutral' ? 'primary' : tone}
        />
      )}
      {hint && <span className="zk-hint">{hint}</span>}
    </div>
  );
}

export function StatGrid({ items, children }: {
  readonly items?: readonly StatCardProps[];
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="zk-stats-grid">
      {items?.map((item, idx) => <StatCard key={idx} {...item} />)}
      {children}
    </div>
  );
}

export interface CopyButtonProps {
  readonly value: string;
  readonly label?: string;
  readonly copiedLabel?: string;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  size = 'sm',
  variant = 'ghost',
}: CopyButtonProps) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button size={size} variant={variant} onClick={handleCopy} aria-label={label ?? t('复制')}>
      {copied ? (copiedLabel ?? `✓ ${t('已复制')}`) : (label ?? t('复制'))}
    </Button>
  );
}

export interface DescriptionItem {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly copyValue?: string;
  readonly hint?: React.ReactNode;
  readonly span?: number;
}

export function DescriptionList({
  items,
  columns = 1,
  bordered = false,
}: {
  readonly items: readonly DescriptionItem[];
  readonly columns?: 1 | 2 | 3;
  readonly bordered?: boolean;
}) {
  if (columns === 1 && !bordered) {
    return (
      <dl className="zk-dl">
        {items.map((item, idx) => (
          <React.Fragment key={idx}>
            <dt>{item.label}</dt>
            <dd>
              <span>{item.value}</span>
              {item.copyValue && <CopyButton value={item.copyValue} />}
              {item.hint && <span className="zk-hint">{item.hint}</span>}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return (
    <div
      style={{ '--zk-kv-cols': columns } as React.CSSProperties}
      className={cx('zk-kv-grid', bordered && 'zk-kv-grid--bordered')}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          style={item.span ? { gridColumn: `span ${item.span}` } : undefined}
          className="zk-kv-item"
        >
          <div className="zk-kv-item__label">
            <span>{item.label}</span>
            {item.copyValue && <CopyButton value={item.copyValue} />}
          </div>
          <div className="zk-kv-item__value">{item.value}</div>
          {item.hint && <span className="zk-hint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}

export interface TimelineEntry {
  readonly id?: string;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly time?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  readonly content?: React.ReactNode;
}

export function Timeline({ items }: { readonly items: readonly TimelineEntry[] }) {
  return (
    <div role="list" className="zk-timeline">
      {items.map((item, idx) => (
        <div
          key={item.id ?? idx}
          role="listitem"
          className={cx('zk-timeline-item', item.tone && item.tone !== 'primary' && `zk-timeline-item--${item.tone}`)}
        >
          <div className="zk-timeline-item__rail" aria-hidden="true">
            <span className="zk-timeline-item__dot" />
            <span className="zk-timeline-item__line" />
          </div>
          <div className="zk-timeline-item__body">
            <div className="zk-timeline-item__head">
              <div className="zk-timeline-item__title">
                <span>{item.title}</span>
                {item.badge}
              </div>
              {item.time && <span className="zk-timeline-item__time">{item.time}</span>}
            </div>
            {item.description && <div className="zk-timeline-item__desc">{item.description}</div>}
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly title?: React.ReactNode;
  readonly copyable?: boolean;
  readonly maxHeight?: number | string;
}

export function CodeBlock({
  code,
  language,
  title,
  copyable = true,
  maxHeight,
}: CodeBlockProps) {
  return (
    <div className="zk-code-block">
      {(title || language || copyable) && (
        <div className="zk-code-block__head">
          <span className="zk-row">
            {title && <strong>{title}</strong>}
            {language && <span className="zk-tag zk-tag--mono">{language}</span>}
          </span>
          {copyable && <CopyButton value={code} />}
        </div>
      )}
      <pre
        className="zk-code-block__pre"
        style={maxHeight ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight, overflowY: 'auto' } : undefined}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function JsonView({
  data,
  title,
  collapsible = false,
  defaultCollapsed = false,
  maxHeight = 320,
}: {
  readonly data: unknown;
  readonly title?: React.ReactNode;
  readonly collapsible?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly maxHeight?: number | string;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2) ?? 'null';
    } catch {
      return String(data);
    }
  }, [data]);
  if (collapsible) {
    return (
      <Collapsible
        title={title ?? 'JSON'}
        defaultOpen={!collapsed}
        onOpenChange={(open) => setCollapsed(!open)}
        badge={<span className="zk-tag zk-tag--mono">{t(collapsed ? '展开' : '收起')}</span>}
      >
        <CodeBlock code={formatted} language="json" maxHeight={maxHeight} />
      </Collapsible>
    );
  }
  return <CodeBlock code={formatted} title={title} language="json" maxHeight={maxHeight} />;
}

export function StatusDot({
  tone = 'neutral',
  pulse = false,
  label,
}: {
  readonly tone?: BadgeTone;
  readonly pulse?: boolean;
  readonly label?: React.ReactNode;
}) {
  return (
    <span className={cx('zk-status-dot', tone !== 'neutral' && `zk-status-dot--${tone}`, pulse && 'zk-status-dot--pulse')}>
      <span className="zk-status-dot__indicator" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  status,
}: {
  readonly name: string;
  readonly src?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly shape?: 'circle' | 'rounded';
  readonly status?: 'online' | 'offline' | 'busy' | 'warning';
}) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?';
  return (
    <span
      title={name}
      className={cx(
        'zk-avatar',
        size !== 'md' && `zk-avatar--${size}`,
        shape === 'rounded' && 'zk-avatar--rounded',
      )}
    >
      {src ? <img src={src} alt={name} className="zk-avatar__img" /> : <span>{initials}</span>}
      {status && <span className={cx('zk-avatar__status', `zk-avatar__status--${status}`)} aria-hidden="true" />}
    </span>
  );
}

export function Tag({
  tone = 'neutral',
  size = 'md',
  monospace = false,
  icon,
  onRemove,
  children,
}: {
  readonly tone?: BadgeTone | 'primary';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly monospace?: boolean;
  readonly icon?: React.ReactNode;
  readonly onRemove?: () => void;
  readonly children: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <span className={cx('zk-tag', tone !== 'neutral' && `zk-tag--${tone}`, size !== 'md' && `zk-tag--${size}`, monospace && 'zk-tag--mono')}>
      {icon}
      <span>{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('移除 {0}', typeof children === 'string' ? children : '')}
          className="zk-tag__remove"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function Kbd({ keys }: { readonly keys: string | readonly string[] }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <kbd className="zk-kbd">
      {list.join(' + ')}
    </kbd>
  );
}

export function Skeleton({
  variant = 'card',
  width,
  height,
  lines = 1,
}: {
  readonly variant?: 'text' | 'card' | 'circle';
  readonly width?: number | string;
  readonly height?: number | string;
  readonly lines?: number;
}) {
  if (variant === 'text' && lines > 1) {
    return (
      <div className="zk-stack" style={{ gap: 8 }} aria-hidden="true">
        {Array.from({ length: lines }, (_, idx) => (
          <span
            key={idx}
            className="zk-skeleton zk-skeleton--text"
            style={{ width: idx === lines - 1 ? '68%' : (width ?? '100%'), ...(height ? { height } : {}) }}
          />
        ))}
      </div>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        'zk-skeleton',
        variant === 'text' && 'zk-skeleton--text',
        variant === 'circle' && 'zk-skeleton--circle',
      )}
      style={{
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }}
    />
  );
}

/* ============================================================================
 * 5. Overlays (Modal, Drawer, Tooltip)
 * ========================================================================== */

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: ModalProps) {
  const { t } = useLocale();
  const titleId = useId();
  useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="zk-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('zk-modal', size !== 'md' && `zk-modal--${size}`)}
      >
        <div className="zk-modal__head">
          <div>
            <h2 id={titleId} className="zk-modal__title">{title}</h2>
            {description && <p className="zk-modal__desc">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('关闭')}</Button>
        </div>
        <div className="zk-modal__body">{children}</div>
        {footer && <div className="zk-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly side?: 'right' | 'left';
  readonly width?: number | string;
  readonly children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  footer,
  side = 'right',
  width,
  children,
}: DrawerProps) {
  const { t } = useLocale();
  const titleId = useId();
  useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={cx('zk-drawer-backdrop', side === 'left' && 'zk-drawer-backdrop--left')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={width ? { width: typeof width === 'number' ? `${width}px` : width } : undefined}
        className="zk-drawer"
      >
        <div className="zk-stack" style={{ gap: 16 }}>
          <div className="zk-drawer__head">
            <div>
              <h2 id={titleId} className="zk-drawer__title">{title}</h2>
              {description && <p className="zk-drawer__desc">{description}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>{t('关闭')}</Button>
          </div>
          <div className="zk-drawer__body">{children}</div>
        </div>
        {footer && <div className="zk-drawer__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tooltip({
  content,
  placement = 'top',
  children,
}: {
  readonly content: React.ReactNode;
  readonly placement?: 'top' | 'bottom';
  readonly children: React.ReactNode;
}) {
  return (
    <span className="zk-tooltip-wrap">
      {children}
      <span role="tooltip" className={cx('zk-tooltip', placement === 'bottom' && 'zk-tooltip--bottom')}>
        {content}
      </span>
    </span>
  );
}
