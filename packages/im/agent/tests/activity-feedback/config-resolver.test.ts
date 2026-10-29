import { describe, it, expect } from 'vitest';
import { resolveActivityFeedbackPhaseConfig } from '../../src/activity-feedback/config-resolver.js';
import type { ActivityFeedbackKindCapabilities } from '../../src/typing-indicator/adapter-integration.js';

const base = { reaction: false, edit: false, recall: true, needsReply: false } as const;
/** A group where the Bot can react (declared `feedback.mode: reaction`). */
const reactionGroup: ActivityFeedbackKindCapabilities = {
  ...base, reaction: true, feedback: { mode: 'reaction' },
};
/** The same Endpoint in private chat: it prefers reactions but has none there. */
const reactionPrivate: ActivityFeedbackKindCapabilities = { ...base, feedback: { mode: 'reaction' } };
const typing: ActivityFeedbackKindCapabilities = { ...base, feedback: { mode: 'typing', refreshSeconds: 4 } };

describe('activity-feedback config-resolver (capability driven)', () => {
  it('reacts when the Endpoint declares reaction feedback and can react here', () => {
    expect(resolveActivityFeedbackPhaseConfig(reactionGroup, undefined, 'queued', 'group')).toEqual({
      type: 'reaction', emoji: '⏳', autoRemove: true,
    });
    expect(resolveActivityFeedbackPhaseConfig(reactionGroup, undefined, 'active', 'group')).toEqual({
      type: 'reaction', emoji: '⏳', autoRemove: true,
    });
  });

  it('uses the emoji the adapter declares', () => {
    const kind = { ...reactionGroup, feedback: { mode: 'reaction', emoji: '60' } } as const;
    expect(resolveActivityFeedbackPhaseConfig(kind, undefined, 'active', 'group')).toMatchObject({
      type: 'reaction', emoji: '60',
    });
  });

  it('shows nothing for a queued turn when no feedback is declared', () => {
    expect(resolveActivityFeedbackPhaseConfig(undefined, undefined, 'queued', 'group')).toEqual({ type: 'none' });
    expect(resolveActivityFeedbackPhaseConfig({ ...base }, undefined, 'queued', 'group')).toEqual({ type: 'none' });
  });

  it('falls back to a status message when nothing is declared', () => {
    expect(resolveActivityFeedbackPhaseConfig(undefined, undefined, 'active', 'group')).toEqual({
      type: 'message', message: '正在处理中...', autoRemove: true,
    });
  });

  it('degrades a reaction to a message where this conversation kind cannot react', () => {
    expect(resolveActivityFeedbackPhaseConfig(reactionPrivate, undefined, 'active', 'private')).toEqual({
      type: 'message', message: '正在处理中...', autoRemove: true,
    });
    expect(resolveActivityFeedbackPhaseConfig(reactionPrivate, undefined, 'thinking', 'private')).toEqual({
      type: 'message', message: '思考中...', autoRemove: true,
    });
    expect(resolveActivityFeedbackPhaseConfig(reactionPrivate, undefined, 'queued', 'private')).toEqual({
      type: 'message', message: '⏳', autoRemove: true,
    });
    // an operator who explicitly asks for a reaction still gets one
    expect(resolveActivityFeedbackPhaseConfig(reactionPrivate, {
      phases: { active: { private: { type: 'reaction' } } },
    }, 'active', 'private')).toMatchObject({ type: 'reaction' });
  });

  it('drives native typing from feedback.mode and passes the refresh interval', () => {
    expect(resolveActivityFeedbackPhaseConfig(typing, undefined, 'active', 'private')).toEqual({
      type: 'typing', autoRemove: true, platformConfig: { keepaliveIntervalMs: 4000 },
    });
  });

  it('uses the status-message text and honours feedback.mode none', () => {
    expect(resolveActivityFeedbackPhaseConfig(
      { ...base, feedback: { mode: 'status-message', text: 'On it' } }, undefined, 'active', 'group',
    )).toEqual({ type: 'message', message: 'On it', autoRemove: true });
    expect(resolveActivityFeedbackPhaseConfig(
      { ...base, feedback: { mode: 'none' } }, undefined, 'active', 'group',
    )).toEqual({ type: 'none' });
  });

  it('merges endpoint phase scene overrides', () => {
    expect(resolveActivityFeedbackPhaseConfig(reactionGroup, {
      phases: {
        queued: { group: { type: 'reaction', emoji: '60' } },
        active: { private: { type: 'message', message: '思考中' } },
      },
    }, 'queued', 'group')).toEqual({ type: 'reaction', emoji: '60', autoRemove: true });
  });

  it('respects enabled=false', () => {
    expect(resolveActivityFeedbackPhaseConfig(reactionGroup, { enabled: false }, 'active', 'group')).toEqual({
      type: 'none',
    });
  });
});
