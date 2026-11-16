/**
 * Shared building blocks of the three declarative renderers (`DeclarativePageView`,
 * `AdapterConsolePage`, `CommentReviewPage`), on top of `@zhin.js/console-ui` (ADR 0063 P2).
 *
 * - The page header (title, description, actions, refresh) goes to the shell through
 *   `usePageChrome`; without a shell (an older Console) the renderer draws it inside the content.
 * - Dangerous actions are outline buttons with a confirmation dialog; solid red is only on the
 *   dialog's confirm button (决策 5).
 * - No `zk-` classes and no injected styles: everything comes from `@zhin.js/console-ui/styles.css`.
 */
import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  ContentStack,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageShell,
  RadioGroup,
  RadioGroupItem,
  RefreshControl,
  SelectField,
  Switch,
  usePageChrome,
  type BadgeProps,
  type ButtonProps,
  type RefreshControlProps,
} from '@zhin.js/console-ui';
import type { PluginUiLocale } from '../ui/locale.js';

/** Tones of the declarative contract (`DeclarativeBadgeTone`). */
export type RendererTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
/** Button variants of the declarative contract, plus the console-ui names. */
export type RendererButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning'
  | 'default' | 'outline' | 'destructive' | 'destructive-outline';

type UiBadgeVariant = NonNullable<BadgeProps['variant']>;
type UiButtonVariant = NonNullable<ButtonProps['variant']>;

/**
 * Badge look for a tone. Normal states (`success`, `neutral`) are muted; only states that need
 * attention are colored (D15 第 1 条).
 */
export function badgeVariantFor(tone: RendererTone | undefined): UiBadgeVariant {
  switch (tone) {
    case 'danger': return 'destructive';
    case 'warning': return 'warning';
    case 'info': return 'info';
    case 'primary': return 'default';
    case 'neutral': return 'outline';
    case 'success':
    default: return 'secondary';
  }
}

export function ToneBadge({ tone, children }: { readonly tone?: RendererTone; readonly children?: React.ReactNode }) {
  return <Badge variant={badgeVariantFor(tone)} data-tone={tone ?? 'neutral'}>{children}</Badge>;
}

export function isDangerVariant(variant: string | undefined): boolean {
  return variant === 'danger' || variant === 'destructive' || variant === 'destructive-outline';
}

/** console-ui variant of a declarative button. `danger` is always `destructive-outline` (决策 5). */
export function buttonVariantFor(variant: string | undefined, fallback: UiButtonVariant = 'outline'): UiButtonVariant {
  switch (variant) {
    case 'primary':
    case 'default': return 'default';
    case 'secondary':
    case 'outline':
    case 'success':
    case 'warning': return 'outline';
    case 'ghost': return 'ghost';
    case 'danger':
    case 'destructive':
    case 'destructive-outline': return 'destructive-outline';
    default: return fallback;
  }
}

/** The default confirmation of a dangerous action without its own `confirm`: 「确认<动作名>？」. */
export function defaultConfirmMessage(label: string, locale: PluginUiLocale): string {
  return locale === 'en' ? `Confirm ${label}?` : `确认${label}？`;
}

/**
 * Confirmation text an action shows before it runs: its own `confirm`, or for a dangerous action
 * without one the default 「确认<动作名>？」; `undefined` runs immediately.
 */
export function resolveConfirmMessage(
  input: { readonly variant?: string; readonly confirm?: string; readonly label: string },
  locale: PluginUiLocale,
): string | undefined {
  if (input.confirm && input.confirm.trim()) return input.confirm;
  return isDangerVariant(input.variant) ? defaultConfirmMessage(input.label, locale) : undefined;
}

export interface ActionButtonProps {
  readonly label: string;
  readonly children?: React.ReactNode;
  /** Declarative variant (`primary` / `secondary` / `ghost` / `danger` …). */
  readonly variant?: string;
  /** Variant when `variant` is not set. */
  readonly fallbackVariant?: UiButtonVariant;
  readonly size?: 'sm' | 'default';
  readonly icon?: React.ReactNode;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** Confirmation text; dangerous actions get a default one (see {@link resolveConfirmMessage}). */
  readonly confirm?: string;
  /** Label of the dialog's confirm button (defaults to the action label). */
  readonly confirmLabel?: string;
  /** Irreversible actions: the text the user must type before confirming. */
  readonly confirmText?: string;
  readonly locale: PluginUiLocale;
  readonly title?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-controls'?: string;
  /** Runs before the confirmation opens (e.g. form validation); `false` keeps it closed. */
  readonly beforeConfirm?: () => boolean;
  readonly onRun: () => unknown;
}

/** A page / row / batch action button; asks for confirmation in a dialog when it must. */
export function ActionButton({
  label, children, variant, fallbackVariant = 'outline', size = 'sm', icon, busy, disabled,
  confirm, confirmLabel, confirmText, locale, title, beforeConfirm, onRun, ...aria
}: ActionButtonProps) {
  const [open, setOpen] = useState(false);
  const danger = isDangerVariant(variant);
  const message = resolveConfirmMessage({ variant, confirm, label }, locale);
  const uiVariant = variant ? buttonVariantFor(variant, fallbackVariant) : fallbackVariant;
  return (
    <>
      <Button
        type="button"
        variant={uiVariant}
        size={size}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title={title}
        data-action-variant={variant}
        onClick={() => {
          if (message) {
            if (beforeConfirm && !beforeConfirm()) return;
            setOpen(true);
          } else void onRun();
        }}
        {...aria}
      >
        {icon}
        {children ?? label}
      </Button>
      {message ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={message}
          variant={danger ? 'destructive' : 'default'}
          confirmLabel={confirmLabel || label}
          {...(confirmText ? { confirmText } : {})}
          onConfirm={async () => { await onRun(); }}
        />
      ) : null}
    </>
  );
}

export interface RendererPageProps {
  readonly title: string;
  readonly description?: string;
  /** Header actions (buttons without a form, status badges). */
  readonly actions?: React.ReactNode;
  readonly refresh?: RefreshControlProps;
  /**
   * The host frames the page itself (e.g. `AdapterConsolePage embedded`): no header in the content
   * even without a shell.
   */
  readonly embedded?: boolean;
  /**
   * What the header `actions` depend on. The chrome is only handed to the shell again when these,
   * the title, the description or the refresh state change: a shell that re-renders the page when
   * the chrome changes would otherwise loop. Without it, `actions` is compared by identity.
   */
  readonly chromeDeps?: readonly unknown[];
  readonly className?: string;
  readonly children?: React.ReactNode;
  readonly [data: `data-${string}`]: string | undefined;
}

/**
 * Content of a renderer page. Hands title, description, actions and refresh to the shell
 * (`usePageChrome`); when no shell listens (an older Console) and the page is not embedded, draws a
 * `PageHeader` above the content instead (ADR 0063「风险」: 旧版 Console 的兼容).
 */
export function RendererPage(props: RendererPageProps) {
  // Two components so an embedded page never registers chrome: it would replace the host page's own.
  return props.embedded ? <EmbeddedRendererPage {...props} /> : <ChromeRendererPage {...props} />;
}

function frame(mode: 'shell' | 'embedded' | 'inline', { className, children, title, description, actions, refresh }: Pick<RendererPageProps, 'className' | 'children' | 'title' | 'description' | 'actions' | 'refresh'>, data: Record<string, string | undefined>) {
  return (
    <div className={className} data-zhin-renderer-page="" data-page-chrome={mode} {...data}>
      <PageShell>
        {mode === 'inline' ? (
          <PageHeader
            title={title}
            description={description}
            actions={refresh || actions ? (
              <ContentStack direction="row" gap="tight" align="center">
                {refresh ? <RefreshControl {...refresh} /> : null}
                {actions}
              </ContentStack>
            ) : undefined}
          />
        ) : null}
        {children}
      </PageShell>
    </div>
  );
}

function dataAttributes(props: RendererPageProps): Record<string, string | undefined> {
  const data: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(props)) if (key.startsWith('data-')) data[key] = value as string | undefined;
  return data;
}

/** @internal Exported for tests. */
export function ChromeRendererPage(props: RendererPageProps) {
  const { title, description } = props;
  const latest = useRef(props);
  latest.current = props;
  // Stable chrome: callbacks read the latest props, so a re-render with new closures does not
  // re-register (which would make a shell that re-renders the page loop).
  const actions = useMemo(() => latest.current.actions, props.chromeDeps ?? [props.actions]);
  const r = props.refresh;
  const updatedAt = r?.updatedAt instanceof Date ? r.updatedAt.getTime() : r?.updatedAt;
  const refresh = useMemo<RefreshControlProps | undefined>(() => {
    const current = latest.current.refresh;
    if (!current) return undefined;
    return {
      ...current,
      onRefresh: () => latest.current.refresh?.onRefresh(),
      ...(current.onAutoRefresh ? { onAutoRefresh: () => (latest.current.refresh?.onAutoRefresh ?? latest.current.refresh?.onRefresh)?.() } : {}),
      ...(current.onIntervalChange ? { onIntervalChange: (value: number) => latest.current.refresh?.onIntervalChange?.(value) } : {}),
    };
  }, [Boolean(r), updatedAt, r?.intervalMs, r?.defaultIntervalMs, r?.refreshing, r?.disabled, Boolean(r?.onAutoRefresh), Boolean(r?.onIntervalChange), r?.intervals?.join(','), r?.className]);
  const hosted = usePageChrome({ title, description, actions, refresh });
  return frame(hosted ? 'shell' : 'inline', { ...props, actions, refresh }, dataAttributes(props));
}

/** @internal Exported for tests. */
export function EmbeddedRendererPage(props: RendererPageProps) {
  return frame('embedded', props, dataAttributes(props));
}

export function NoticeBlock({ tone = 'info', children, onDismiss, dismissLabel, actions }: {
  readonly tone?: 'info' | 'success' | 'warning' | 'danger';
  readonly children?: React.ReactNode;
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
  readonly actions?: React.ReactNode;
}) {
  const variant = tone === 'danger' ? 'destructive' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'default';
  return (
    <Alert variant={variant} role={tone === 'danger' ? 'alert' : 'status'} data-tone={tone}>
      <AlertDescription>
        <ContentStack direction="row" gap="tight" justify="between" align="center">
          <span>{children}</span>
          {actions || onDismiss ? (
            <ContentStack direction="row" gap="tight" align="center">
              {actions}
              {onDismiss ? <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>{dismissLabel ?? '关闭'}</Button> : null}
            </ContentStack>
          ) : null}
        </ContentStack>
      </AlertDescription>
    </Alert>
  );
}

/** Loading placeholder; the console-ui block (skeleton lines sized by tokens, no utility classes). */
export { LoadingBlock } from '@zhin.js/console-ui';

export function ErrorBlock({ message, details, onRetry }: { readonly message: string; readonly details?: string; readonly onRetry?: () => void }) {
  return <ErrorAlert error={message} onRetry={onRetry} {...(details && details !== message ? { technicalDetail: details } : {})} />;
}

export function EmptyBlock({ title, description, action }: { readonly title: string; readonly description?: string; readonly action?: React.ReactNode }) {
  return (
    <ContentStack gap="tight" align="center">
      <EmptyState compact title={title} description={description} />
      {action}
    </ContentStack>
  );
}

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly disabled?: boolean;
}

/** Radix select (never the native select element); an empty value shows `placeholder`. */
export function ChoiceSelect({ value, options, placeholder, onValueChange, disabled, id, 'aria-label': ariaLabel }: {
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly placeholder?: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly 'aria-label'?: string;
}) {
  const listed = options.some(option => option.value === value);
  // An unset or unknown value stays visible as a disabled first item (the placeholder for '').
  const items = [
    ...(listed ? [] : [{ value, label: value === '' ? (placeholder ?? '—') : value, disabled: true }]),
    ...options.map(option => ({ value: option.value, label: option.label, disabled: option.disabled })),
  ];
  return <SelectField id={id} aria-label={ariaLabel} value={value} options={items} disabled={disabled} onValueChange={onValueChange} />;
}

export function SwitchRow({ checked, onCheckedChange, label, description, disabled, 'aria-label': ariaLabel }: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  /** Accessible name when the visible label alone is ambiguous (e.g. 「10001：已停止」). */
  readonly 'aria-label'?: string;
}) {
  const id = useId();
  return (
    <ContentStack gap="tight">
      <ContentStack direction="row" gap="tight" align="center">
        <Switch id={id} checked={checked} disabled={disabled} aria-label={ariaLabel} onCheckedChange={onCheckedChange} />
        <label htmlFor={id}>{label}</label>
      </ContentStack>
      {description ? <span className="console-form-field-hint">{description}</span> : null}
    </ContentStack>
  );
}

export function RadioChoices({ value, options, onValueChange, direction, 'aria-label': ariaLabel }: {
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly onValueChange: (value: string) => void;
  readonly direction?: 'column' | 'row' | 'grid';
  readonly 'aria-label'?: string;
}) {
  const id = useId();
  return (
    <RadioGroup value={value} onValueChange={onValueChange} aria-label={ariaLabel}>
      <ContentStack direction={direction === 'row' ? 'row' : 'column'} gap="tight">
        {options.map(option => (
          <ContentStack key={option.value} direction="row" gap="tight" align="start">
            <RadioGroupItem id={`${id}-${option.value}`} value={option.value} disabled={option.disabled} />
            <label htmlFor={`${id}-${option.value}`}>
              <ContentStack gap="tight">
                <span>{option.icon}{option.label}{option.badge}</span>
                {option.description ? <span className="console-form-field-hint">{option.description}</span> : null}
              </ContentStack>
            </label>
          </ContentStack>
        ))}
      </ContentStack>
    </RadioGroup>
  );
}

export function CheckboxChoices({ value, options, onValueChange, direction }: {
  readonly value: readonly string[];
  readonly options: readonly ChoiceOption[];
  readonly onValueChange: (value: string[]) => void;
  readonly direction?: 'column' | 'row' | 'grid';
}) {
  const id = useId();
  const selected = new Set(value);
  return (
    <ContentStack direction={direction === 'row' ? 'row' : 'column'} gap="tight" role="group">
      {options.map(option => (
        <ContentStack key={option.value} direction="row" gap="tight" align="start">
          <Checkbox
            id={`${id}-${option.value}`}
            checked={selected.has(option.value)}
            disabled={option.disabled}
            onCheckedChange={checked => {
              const next = new Set(selected);
              if (checked === true) next.add(option.value);
              else next.delete(option.value);
              onValueChange(options.map(item => item.value).filter(item => next.has(item)));
            }}
          />
          <label htmlFor={`${id}-${option.value}`}>
            <ContentStack gap="tight">
              <span>{option.icon}{option.label}{option.badge}</span>
              {option.description ? <span className="console-form-field-hint">{option.description}</span> : null}
            </ContentStack>
          </label>
        </ContentStack>
      ))}
    </ContentStack>
  );
}

/** Single choice as a row of toggle buttons. */
export function SegmentedChoices({ value, options, onValueChange, 'aria-label': ariaLabel }: {
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly onValueChange: (value: string) => void;
  readonly 'aria-label'?: string;
}) {
  return (
    <ContentStack direction="row" gap="tight" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? 'default' : 'outline'}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
        >
          {option.icon}{option.label}{option.badge}
        </Button>
      ))}
    </ContentStack>
  );
}
