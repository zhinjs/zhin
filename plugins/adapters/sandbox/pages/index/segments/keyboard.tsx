import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '@zhin.js/console-ui';
import { sandboxText } from '../messages.js';
import { recordItems, type SandboxSegmentRenderer } from './context.js';

/** ADR 0063 决策 5: a dangerous choice is an outline button with destructive text, never a solid red one. */
export function interactionVariant(primary: boolean, danger: boolean): 'default' | 'destructive-outline' | 'outline' {
  if (danger) return 'destructive-outline';
  return primary ? 'default' : 'outline';
}

type KeyboardButton = { id?: string; label: string; payload: string; disabled?: boolean; style?: string };

/**
 * Whether one click answers the whole keyboard. Only an approval prompt is a single choice; other
 * keyboards (game boards, menus, several independent actions on one card) keep every button usable
 * after a click (#1250 `sandbox-submitted-without-feedback`); Core retires stale prompts itself.
 */
export function isExclusiveKeyboard(data: Readonly<Record<string, unknown>>): boolean {
  return data.purpose === 'approval';
}

/** Native buttons for a `keyboard` segment (the Sandbox declares `interactive: 'native'`). */
export const renderKeyboard: SandboxSegmentRenderer = (data, context, key) => {
  // Malformed rows / buttons (history from browser storage) are skipped, never a render failure.
  const rows = (Array.isArray(data.rows) ? data.rows : []).map((row: unknown) => recordItems(row)
    .filter((btn) => typeof btn.label === 'string' && typeof btn.payload === 'string') as unknown as KeyboardButton[]);
  const exclusive = isExclusiveKeyboard(data);
  const resolved = Boolean(context.messageId && context.interactionResolved) && exclusive;
  const submitted = new Set(context.submittedPayloads ?? []);
  // #1250: every option stays a button; a long keyboard scrolls instead of being cut.
  const long = rows.flat().length > 10;
  return (
    <div key={key} className={long ? 'agent-playground-approval-actions is-long' : 'agent-playground-approval-actions'}>
      {rows.map((row, ri) => (
        <div key={ri}>
          {row.map((btn, bi) => (
            <Button
              key={`${btn.payload}-${bi}`}
              type="button"
              size="sm"
              variant={interactionVariant(
                btn.style === 'primary' || /^允许/u.test(btn.label),
                btn.style === 'danger' || /拒绝|取消/u.test(btn.label),
              )}
              disabled={btn.disabled || resolved || !context.canInteract}
              aria-pressed={!exclusive && submitted.has(btn.payload) ? true : undefined}
              onClick={() => { context.sendAction(btn.payload, typeof btn.id === 'string' && btn.id ? btn.id : undefined); }}
            >
              {!exclusive && submitted.has(btn.payload) && <Check size={12} aria-hidden="true" />}
              {btn.label}
            </Button>
          ))}
        </div>
      ))}
      {resolved && <small><Check size={12} />{sandboxText(context.locale, "已提交本次选择")}</small>}
    </div>
  );
};

/** Legacy stored `button` segments (JSX `<button>` is bound to a `keyboard` segment today). */
export const renderLegacyButton: SandboxSegmentRenderer = (data, context, key) => {
  const label = String(data.label ?? data.text ?? data.id ?? 'Button');
  const payload = String(data.payload ?? data.id ?? label);
  const resolved = Boolean(context.messageId && context.interactionResolved);
  return (
    <div key={key} className="agent-playground-approval-actions">
      <div>
        <Button type="button" size="sm" variant={interactionVariant(data.style === 'primary', data.style === 'danger')}
          disabled={Boolean(data.disabled) || resolved || !context.canInteract}
          onClick={() => { context.sendAction(payload, typeof data.id === 'string' && data.id ? data.id : undefined); }}>
          {label}
        </Button>
      </div>
    </div>
  );
};
