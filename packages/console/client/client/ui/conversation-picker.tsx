/**
 * Conversation picker and label for plugin pages (#1250).
 *
 * `ConversationPicker` lets an operator choose where a plugin delivers (RSS pushes, reminders, …)
 * from the bot's accounts and recent conversations instead of typing platform / target ids, with
 * manual entry kept as an advanced option. `ConversationLabel` shows a stored conversation key by
 * its display name. Both read the page's shared directory ({@link useSharedConversationDirectory}).
 */
import React, { useMemo, useState } from 'react';
import { Badge, Button, Input, Notice, Select } from './components.js';
import { useLocale, type PluginUiLocale } from './locale.js';
import {
  conversationAddressKey,
  conversationKindLabel,
  formatConversationLabel,
  parseConversationAddress,
  serializeConversationAddress,
  useSharedConversationDirectory,
  type ConversationAddress,
  type ConversationDirectory,
  type ConversationKind,
} from './conversation-directory.js';

const ALL_KINDS: readonly ConversationKind[] = ['group', 'private', 'channel'];

export interface ConversationOption {
  readonly key: string;
  readonly address: ConversationAddress;
  readonly label: string;
  readonly lastActiveAt?: number;
}

/**
 * Recent conversations matching `query` (name, id, account or kind word, case-insensitive) and
 * one of `kinds`, newest first, at most `limit`.
 */
export function filterConversationOptions(
  directory: ConversationDirectory,
  query: string,
  options: { readonly kinds?: readonly ConversationKind[]; readonly locale?: PluginUiLocale; readonly limit?: number } = {},
): ConversationOption[] {
  const kinds = new Set(options.kinds?.length ? options.kinds : ALL_KINDS);
  const needle = query.trim().toLowerCase();
  const locale = options.locale ?? 'zh-CN';
  const result: ConversationOption[] = [];
  for (const entry of directory.conversations) {
    if (!kinds.has(entry.address.kind)) continue;
    const description = directory.describe(entry.address);
    if (!description) continue;
    const label = formatConversationLabel(description, locale);
    if (needle) {
      const haystack = [label, entry.address.id, entry.name ?? '', entry.accountName ?? '',
        entry.address.endpoint.adapter, conversationKindLabel(entry.address.kind, 'zh-CN'),
        conversationKindLabel(entry.address.kind, 'en')].join(' ').toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    result.push({
      key: conversationAddressKey(entry.address),
      address: entry.address,
      label,
      ...(entry.lastActiveAt !== undefined ? { lastActiveAt: entry.lastActiveAt } : {}),
    });
    if (result.length >= (options.limit ?? 20)) break;
  }
  return result;
}

export interface ConversationPickerProps {
  /** The selected conversation as JSON (`serializeConversationAddress`), or empty. */
  readonly value?: string;
  /** Receives the JSON of the chosen `DeliveryTarget` (empty string when cleared) and the address. */
  readonly onChange: (value: string, address?: ConversationAddress) => void;
  /** Conversation kinds the caller accepts; default all. */
  readonly kinds?: readonly ConversationKind[];
  readonly disabled?: boolean;
  /** Show the 「手动填写」 advanced option (default true). */
  readonly allowManual?: boolean;
  /** Maximum options listed (default 20). */
  readonly limit?: number;
}

export function ConversationPicker({
  value,
  onChange,
  kinds,
  disabled,
  allowManual = true,
  limit,
}: ConversationPickerProps) {
  const { locale, t } = useLocale();
  const { directory, loading, error, inboxAvailable } = useSharedConversationDirectory();
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(false);
  const allowedKinds = kinds?.length ? kinds : ALL_KINDS;
  const [manualAccount, setManualAccount] = useState('');
  const [manualKind, setManualKind] = useState<ConversationKind>(allowedKinds[0] ?? 'group');
  const [manualId, setManualId] = useState('');
  // Without `endpoint.view` no accounts are listed; the account is then typed in by hand.
  const [manualAdapter, setManualAdapter] = useState('');
  const [manualEndpointId, setManualEndpointId] = useState('');

  const selected = useMemo(() => parseConversationAddress(value), [value]);
  const selectedLabel = selected
    ? formatConversationLabel(directory.describe(selected) ?? { address: selected, id: selected.id }, locale)
    : undefined;
  const options = useMemo(
    () => filterConversationOptions(directory, query, { kinds: allowedKinds, locale, ...(limit ? { limit } : {}) }),
    [directory, query, allowedKinds, locale, limit],
  );
  const choose = (address: ConversationAddress) => onChange(serializeConversationAddress(address), address);

  const accountsListed = directory.accounts.length > 0;
  const account = directory.accounts.find(item => `${item.adapter}\u0000${item.endpointId}` === manualAccount)
    ?? (directory.accounts.length === 1 ? directory.accounts[0] : undefined);
  const manualEndpoint = accountsListed
    ? account && { adapter: account.adapter, id: account.endpointId }
    : manualAdapter.trim() && manualEndpointId.trim()
      ? { adapter: manualAdapter.trim(), id: parseManualEndpointId(manualEndpointId) }
      : undefined;
  const manualAddress: ConversationAddress | undefined = manualEndpoint && manualId.trim()
    ? { endpoint: manualEndpoint, kind: manualKind, id: manualId.trim() }
    : undefined;

  return (
    <div className="zk-conversation-picker" data-zhin-conversation-picker="">
      {selected && selectedLabel && (
        <div className="zk-row" data-conversation-selected={conversationAddressKey(selected)}>
          <Badge tone="info">{t('已选择')}</Badge>
          <span>{selectedLabel}</span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange('')}>{t('清除')}</Button>
        </div>
      )}
      <Input
        value={query}
        disabled={disabled}
        clearable
        onClear={() => setQuery('')}
        placeholder={t('搜索群名、昵称、ID 或账号')}
        aria-label={t('搜索会话')}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
      />
      {error && (
        <Notice tone="warning">{t('无法读取账号与最近会话（需要「查看账号」权限 endpoint.view），可手动填写。')}</Notice>
      )}
      {!error && !loading && !inboxAvailable && (
        <Notice tone="info">{t('无法读取最近会话，仅列出账号；可手动填写会话 ID。')}</Notice>
      )}
      <ul role="listbox" aria-label={t('最近会话')} className="zk-conversation-picker__list">
        {options.map(option => {
          const isSelected = selected !== undefined && conversationAddressKey(selected) === option.key;
          return (
            <li key={option.key} role="option" aria-selected={isSelected}>
              <button
                type="button"
                className="zk-conversation-picker__option"
                disabled={disabled}
                data-conversation-key={option.key}
                onClick={() => choose(option.address)}
              >
                {option.label}
              </button>
            </li>
          );
        })}
      </ul>
      {!loading && options.length === 0 && (
        <span className="zk-hint">{query.trim() ? t('没有匹配的最近会话') : t('暂无最近会话')}</span>
      )}
      {allowManual && (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setManual(open => !open)}>
          {manual ? t('收起手动填写') : t('手动填写（高级）')}
        </Button>
      )}
      {allowManual && manual && (
        <div className="zk-conversation-picker__manual" data-conversation-manual="">
          {accountsListed ? (
            <Select
              aria-label={t('机器人账号')}
              value={account ? `${account.adapter}\u0000${account.endpointId}` : manualAccount}
              placeholder={t('选择机器人账号')}
              onValueChange={setManualAccount}
              options={directory.accounts.map(item => ({
                value: `${item.adapter}\u0000${item.endpointId}`,
                label: `${item.name}（${item.adapter}）`,
              }))}
            />
          ) : (
            <>
              <span className="zk-hint" data-conversation-manual-hint="">
                {t('未列出机器人账号（读取账号列表需要「查看账号」权限 endpoint.view），请手动填写适配器与账号 ID。')}
              </span>
              <Input
                aria-label={t('适配器')}
                placeholder={t('适配器名称')}
                value={manualAdapter}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setManualAdapter(event.target.value)}
              />
              <Input
                aria-label={t('账号 ID')}
                placeholder={t('账号的规范 endpoint ID')}
                value={manualEndpointId}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setManualEndpointId(event.target.value)}
              />
            </>
          )}
          <Select
            aria-label={t('会话类型')}
            value={manualKind}
            onValueChange={next => setManualKind(next as ConversationKind)}
            options={allowedKinds.map(kind => ({ value: kind, label: conversationKindLabel(kind, locale) }))}
          />
          <Input
            aria-label={t('会话 ID')}
            placeholder={t('群号 / 用户 ID / 频道 ID')}
            value={manualId}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setManualId(event.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !manualAddress}
            onClick={() => { if (manualAddress) choose(manualAddress); }}
          >
            {t('使用该会话')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A hand-typed canonical endpoint id. Canonical ids separate their segments with NUL, which cannot
 * be typed, so the escapes `\0` / `\u0000` are accepted for it.
 */
export function parseManualEndpointId(value: string): string {
  return value.trim().replace(/\\u0000|\\0/gu, '\u0000');
}

export interface ConversationLabelProps {
  /** Conversation key (`["conversation-v1", …]`), `DeliveryTarget`, or their JSON. */
  readonly value: unknown;
  /** Append the bot account (default true). */
  readonly showAccount?: boolean;
}

/** Display name of a stored conversation; unparsable values are shown as they are. */
export function ConversationLabel({ value, showAccount }: ConversationLabelProps) {
  const { locale } = useLocale();
  const address = parseConversationAddress(value);
  const { directory } = useSharedConversationDirectory({ enabled: address !== undefined });
  if (!address) {
    const raw = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    return <span>{raw || '—'}</span>;
  }
  const description = directory.describe(address) ?? { address, id: address.id };
  return (
    <span title={address.id} data-conversation-key={conversationAddressKey(address)}>
      {formatConversationLabel(description, locale, { showAccount: showAccount !== false })}
    </span>
  );
}

/** Styles for the picker; included by the declarative page and safe to add to custom pages. */
export const conversationPickerStyles = `
.zk-conversation-picker { display: flex; flex-direction: column; gap: 8px; }
.zk-conversation-picker__list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; border: 1px solid var(--zk-border); border-radius: 8px; }
.zk-conversation-picker__list:empty { display: none; }
.zk-conversation-picker__option { width: 100%; text-align: left; padding: 6px 10px; background: transparent; border: 0; color: inherit; cursor: pointer; font: inherit; }
.zk-conversation-picker__option:hover, .zk-conversation-picker__option:focus-visible { background: var(--zk-surface-muted, rgba(127,127,127,.08)); }
[aria-selected="true"] > .zk-conversation-picker__option { font-weight: 600; }
.zk-conversation-picker__manual { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); align-items: end; }
`;
