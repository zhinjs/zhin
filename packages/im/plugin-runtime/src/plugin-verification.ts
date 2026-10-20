import { createToken } from './token.js';

/** A deliberate business check. Effects must describe every write or external action. */
export interface PluginVerificationCheck {
  readonly id: string;
  readonly title: string;
  readonly effects: readonly string[];
  readonly scope: 'local' | 'platform';
}

export interface PluginVerificationOutcome {
  readonly status: 'passed' | 'failed';
  readonly summary: string;
  readonly evidence: readonly string[];
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
