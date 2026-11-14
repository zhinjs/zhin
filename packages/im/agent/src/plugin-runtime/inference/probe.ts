/**
 * Connectivity probe for a language Profile (#1250 purpose-save probe, account "test connection").
 * Sends one minimal chat request that carries a tool definition, because a relay that serves plain
 * chat but hangs or rejects tool requests breaks the agent turn in exactly that way. The result is
 * an outcome class only: no provider text, headers, request content or credentials leave this file.
 */
import { z } from 'zod';
import { classifyProviderError, createUserMessage, type ProviderErrorKind } from '@zhin.js/ai';
import { ProviderError, type InferenceClient } from '@zhin.js/ai/provider';
import { InferenceAuthenticationError } from './credentials.js';

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

export interface InferenceProbeResult {
  readonly status: 'ok' | 'failed';
  /** Failure class: a provider error kind, `credential` (no usable key / login), or a Host-side reason. */
  readonly kind?: ProviderErrorKind | 'credential' | 'profile-not-found' | 'unavailable';
  /** Closed-set code for `credential` / `unavailable` failures (e.g. `not-authorized`). */
  readonly code?: string;
  readonly httpStatus?: number;
  readonly durationMs: number;
  readonly at: number;
  readonly profileId: string;
}

const PROBE_TOOL = Object.freeze({
  name: 'zhin_connectivity_probe',
  description: 'Connectivity check. Do not call this tool; reply with the single word OK.',
  parameters: z.object({}),
});

export async function probeLanguageProfile(input: Readonly<{
  client: InferenceClient;
  profileId: string;
  signal: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}>): Promise<InferenceProbeResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const done = (fields: Omit<InferenceProbeResult, 'durationMs' | 'at' | 'profileId'>): InferenceProbeResult =>
    Object.freeze({ ...fields, durationMs: Math.max(0, now() - started), at: now(), profileId: input.profileId });
  const profiles = await input.client.list({ kind: 'language' });
  const profile = profiles.find(view => view.reference.id === input.profileId);
  if (!profile) return done({ status: 'failed', kind: 'profile-not-found' });
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(Object.assign(new Error('probe timed out'), { name: 'TimeoutError' })), timeoutMs);
  try {
    const reply = await input.client.generate({
      profile: profile.reference,
      request: {
        context: { systemPrompt: 'Reply with the single word OK.', messages: [createUserMessage('ping')], tools: [PROBE_TOOL] },
        options: { maxRetries: 0 },
      },
      signal: AbortSignal.any([input.signal, deadline.signal]),
    });
    return reply.stopReason === 'error' ? done({ status: 'failed', kind: 'server' }) : done({ status: 'ok' });
  } catch (error) {
    if (deadline.signal.aborted && !input.signal.aborted) return done({ status: 'failed', kind: 'timeout' });
    if (input.signal.aborted) throw input.signal.reason;
    if (error instanceof InferenceAuthenticationError) return done({ status: 'failed', kind: 'credential', code: error.code });
    if (error instanceof ProviderError) return done({ status: 'failed', kind: 'unavailable', code: error.code });
    const facts = classifyProviderError(error);
    return done({ status: 'failed', kind: facts.kind, ...(facts.status !== undefined ? { httpStatus: facts.status } : {}) });
  } finally {
    clearTimeout(timer);
  }
}
