import { createToken } from './token.js';
import type { Locale } from './i18n.js';

/** A deliberate business check. Effects must describe every write or external action. */
export interface PluginVerificationCheck {
  readonly id: string;
  readonly title: string;
  readonly titleI18n?: Readonly<Partial<Record<Locale, string>>>;
  readonly effects: readonly string[];
  readonly effectsI18n?: Readonly<Partial<Record<Locale, readonly string[]>>>;
  readonly scope: 'local' | 'platform';
}

export interface PluginVerificationOutcome {
  readonly status: 'passed' | 'failed';
  readonly summary: string;
  readonly summaryI18n?: Readonly<Partial<Record<Locale, string>>>;
  readonly evidence: readonly string[];
  readonly evidenceI18n?: Readonly<Partial<Record<Locale, readonly string[]>>>;
}

/** Plugin-owned optional verification, distinct from generation publication/readiness. */
export interface PluginVerificationHost {
  checks(): readonly PluginVerificationCheck[];
  run(checkId: string): Promise<PluginVerificationOutcome>;
}

export const pluginVerificationToken = createToken<PluginVerificationHost>(
  'zhin.plugin-verification',
  'Explicit plugin business checks, executed only on user request',
);
