/**
 * Smart cell / entry values of the declarative renderer, on `@zhin.js/console-ui` (ADR 0063 P2).
 * Normal states render as muted badges (D15); raw JSON stays collapsed (D18 第 6 条).
 */
import React from 'react';
import {
  Badge,
  Button,
  CodeText,
  ContentStack,
  Disclosure,
  JsonBlock,
  ProgressMeter,
} from '@zhin.js/console-ui';
import { ConversationLabel } from '../ui/conversation-picker.js';
import type { PluginUiText } from '../ui/locale.js';
import { ToneBadge } from '../renderer/kit.js';
import { CODE_KEY_PATTERN, classifySemanticStatus, type BadgeTone, type DeclarativeColumnType } from './model.js';

export interface SmartValueOptions {
  readonly type?: DeclarativeColumnType;
  readonly copyable?: boolean;
  readonly toneMap?: Readonly<Record<string, BadgeTone>>;
}

export interface CopyState {
  /** Key of the value copied last (shows 「已复制」 briefly). */
  readonly copiedKey: string;
  readonly onCopy: (key: string, text: string) => void;
}

const EMPTY = <span className="console-kv-value is-muted" data-empty="">—</span>;

export function CopyValueButton({ copyKey, text, copy, t, label }: {
  readonly copyKey: string;
  readonly text: string;
  readonly copy: CopyState;
  readonly t: PluginUiText['t'];
  readonly label?: string;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => copy.onCopy(copyKey, text)} data-copy-key={copyKey}>
      {copy.copiedKey === copyKey ? t('已复制') : (label ?? t('复制'))}
    </Button>
  );
}

/** Raw JSON behind a collapsed disclosure (D18 第 6 条: JSON is not shown by default). */
export function JsonValue({ value, t }: { readonly value: unknown; readonly t: PluginUiText['t'] }) {
  return (
    <Disclosure summary={t('查看 JSON')}>
      <JsonBlock value={value} />
    </Disclosure>
  );
}

export function renderSmartValue(
  raw: unknown,
  fieldKey: string | undefined,
  copyKey: string,
  copy: CopyState,
  t: PluginUiText['t'],
  spec?: SmartValueOptions,
): React.ReactNode {
  if (raw === null || raw === undefined || raw === '') return EMPTY;
  const type = spec?.type ?? 'auto';
  if (type === 'conversation') return <ConversationLabel value={raw} />;
  if (type === 'progress') {
    const value = Number(raw);
    return Number.isFinite(value) ? <ProgressMeter value={value} showValue /> : EMPTY;
  }
  if (type === 'boolean' || typeof raw === 'boolean') {
    const on = typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
    return <ToneBadge tone="neutral">{on ? t('是') : t('否')}</ToneBadge>;
  }
  if (type === 'badge') {
    const text = String(raw);
    return <ToneBadge tone={spec?.toneMap?.[text] ?? classifySemanticStatus(text) ?? 'neutral'}>{text}</ToneBadge>;
  }
  if (type === 'datetime') {
    const date = typeof raw === 'number' || typeof raw === 'string' ? new Date(raw) : null;
    if (date && !Number.isNaN(date.getTime())) return <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>;
  }
  if (type === 'json') return <JsonValue value={raw} t={t} />;
  if (type === 'tags' || Array.isArray(raw)) {
    const list = (Array.isArray(raw) ? raw : String(raw).split(',').map(item => item.trim()))
      .filter(item => item !== null && item !== undefined && item !== '');
    if (list.length === 0) return EMPTY;
    if (list.some(item => typeof item === 'object')) return <JsonValue value={list} t={t} />;
    return (
      <ContentStack direction="row" gap="tight">
        {list.map((item, index) => <Badge key={index} variant="secondary">{String(item)}</Badge>)}
      </ContentStack>
    );
  }
  const codeLike = type === 'code' || spec?.copyable === true || (type === 'auto' && fieldKey !== undefined && CODE_KEY_PATTERN.test(fieldKey));
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text || text === '-' || text === '—') return EMPTY;
    if (type === 'link' || /^https?:\/\/\S+$/iu.test(text)) {
      return (
        <ContentStack direction="row" gap="tight">
          <a className="console-touch" href={text} target="_blank" rel="noopener noreferrer">{text}</a>
          <CopyValueButton copyKey={copyKey} text={text} copy={copy} t={t} />
        </ContentStack>
      );
    }
    if (spec?.toneMap && Object.prototype.hasOwnProperty.call(spec.toneMap, text)) {
      return <ToneBadge tone={spec.toneMap[text]}>{text}</ToneBadge>;
    }
    if (type === 'auto') {
      const tone = classifySemanticStatus(text);
      if (tone !== undefined) return <ToneBadge tone={tone}>{text}</ToneBadge>;
    }
    if (codeLike) {
      return (
        <ContentStack direction="row" gap="tight">
          <CodeText>{text}</CodeText>
          <CopyValueButton copyKey={copyKey} text={text} copy={copy} t={t} />
        </ContentStack>
      );
    }
    return text;
  }
  if (typeof raw === 'number') {
    if (codeLike) {
      return (
        <ContentStack direction="row" gap="tight">
          <CodeText>{String(raw)}</CodeText>
          <CopyValueButton copyKey={copyKey} text={String(raw)} copy={copy} t={t} />
        </ContentStack>
      );
    }
    return String(raw);
  }
  if (typeof raw === 'object' && !React.isValidElement(raw)) return <JsonValue value={raw} t={t} />;
  return raw as React.ReactNode;
}

/**
 * Splits a row for an automatic card: shown fields, and the technical ones (ID-like keys, objects)
 * that go behind 「技术详情」 (D18 第 6 条).
 */
export function splitTechnicalFields(row: Readonly<Record<string, unknown>>): { readonly shown: [string, unknown][]; readonly technical: [string, unknown][] } {
  const shown: [string, unknown][] = [];
  const technical: [string, unknown][] = [];
  for (const entry of Object.entries(row)) {
    const [key, value] = entry;
    if (/(?:^id$|Id$|_id$|Key$|^key$)/u.test(key) || (value !== null && typeof value === 'object')) technical.push(entry);
    else shown.push(entry);
  }
  return { shown, technical };
}
