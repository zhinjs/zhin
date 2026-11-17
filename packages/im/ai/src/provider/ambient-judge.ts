/**
 * The interjection judge (ADR 0066): one deployment-level policy, `purposes.ambient`, whose model
 * chain may mix language and decision Profiles. The legacy stored forms — the language purpose
 * `defaults.ambient` / `defaults.ambientFallbacks` and the decision purpose `decisions.ambient` —
 * are converted by one table (D5), both by the one-time stored migration and, until it succeeds,
 * in memory. Pure: no I/O.
 */
import type { AmbientJudgePolicy, PurposePolicy } from './types.js';

/** The six keys of `purposes.ambient` (D1); any other key is an error. */
export const AMBIENT_JUDGE_KEYS = Object.freeze(['profile', 'fallbacks', 'compare', 'minConfidence', 'mode', 'timeoutMs'] as const);
/** The one engagement threshold when none is set (D4). */
export const DEFAULT_AMBIENT_MIN_CONFIDENCE = 0.7;
/** One decision-model evaluation of the judge chain when `timeoutMs` is unset (D2). */
export const DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS = 3_000;
/** Id of the ADR 0066 migration record. */
export const AMBIENT_JUDGE_MIGRATION_ID = 'adr-0066-ambient-judge';

/**
 * Deprecation window of the legacy import forms (D5.6): `purposes.decisions.ambient` in a plan is
 * converted with a warning in the minor that ships P1 (`@zhin.js/ai` 1.8) and the next one (1.9);
 * from 1.10 set this to `reject` (then the plan fails with `invalid-plan` at that path) and make
 * `zhin doctor` report the `ai.trigger.ambient.minConfidence` / `mode` keys as errors.
 */
export const AMBIENT_JUDGE_LEGACY_IMPORT: 'convert' | 'reject' = 'convert';

/** `ai.trigger.ambient` keys of `zhin.config.yml` retired by ADR 0066 D4 (read once by the migration). */
export interface LegacyAmbientTrigger {
  readonly minConfidence?: unknown;
  readonly mode?: unknown;
}

/** Why the conversion dropped or chose a value; shown by `zhin doctor` once after the migration. */
export type AmbientJudgeMigrationNoteCode =
  /** `decisions.ambient` was active: the former language judge is now the first fallback. */
  | 'language-judge-became-fallback'
  /** `decisions.ambient` was active and the language judge followed chat: chat is not added as a fallback. */
  | 'inherited-chat-not-added'
  /** `decisions.ambient` was active: the threshold is the larger of the two former thresholds. */
  | 'threshold-max'
  /** `decisions.ambient` was shadow: its `minConfidence` only gated the shadow record and is dropped. */
  | 'shadow-threshold-dropped'
  /** `decisions.ambient` was off: its Profile was never called and is not migrated (the Profile stays). */
  | 'off-profile-not-migrated';

export interface AmbientJudgeMigrationNote {
  readonly code: AmbientJudgeMigrationNoteCode;
  /** The Profile or value the note is about, when it names one. */
  readonly value?: string | number;
}

/** One field of the converted policy and where its value came from (a stored path or `ai.trigger.ambient.*`). */
export interface AmbientJudgeMigrationRow {
  readonly field: (typeof AMBIENT_JUDGE_KEYS)[number];
  readonly value: string | number | readonly string[];
  readonly from: string;
}

export interface AmbientJudgeConversion {
  readonly ambient: AmbientJudgePolicy;
  readonly rows: readonly AmbientJudgeMigrationRow[];
  readonly notes: readonly AmbientJudgeMigrationNote[];
}

/** Whether a stored `purposes` still carries a legacy ambient field (D5.1). */
export function hasLegacyAmbientJudgeFields(purposes: PurposePolicy): boolean {
  return purposes.defaults.ambient !== undefined || purposes.defaults.ambientFallbacks !== undefined
    || purposes.decisions?.ambient !== undefined;
}

/** The yml keys retired by D4 that are set (`minConfidence`, `mode`). */
export function legacyAmbientTriggerKeys(trigger: LegacyAmbientTrigger | undefined): readonly ('minConfidence' | 'mode')[] {
  if (!trigger || typeof trigger !== 'object') return [];
  return (['minConfidence', 'mode'] as const).filter(key => Object.hasOwn(trigger, key) && trigger[key] !== undefined);
}

function triggerConfidence(trigger: LegacyAmbientTrigger | undefined): number | undefined {
  const value = trigger?.minConfidence;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function triggerMode(trigger: LegacyAmbientTrigger | undefined): 'active' | 'shadow' | undefined {
  return trigger?.mode === 'shadow' || trigger?.mode === 'active' ? trigger.mode : undefined;
}

/**
 * The D5 table: `L` = legacy `defaults.ambient` (+ `ambientFallbacks`), `D` = legacy
 * `decisions.ambient`, `T` = yml `ai.trigger.ambient`.
 *
 * | old | profile | fallbacks | compare | minConfidence | mode | timeoutMs |
 * | no `D` / `D.mode = off` | L | L.fallbacks | — | T | T | — |
 * | `D.mode = active` | D.profile | [L, ...L.fallbacks] | — | max(T ?? 0.7, D ?? 0) | T | D |
 * | `D.mode = shadow` | L | L.fallbacks | D.profile | T | T | D |
 */
export function convertLegacyAmbientJudge(purposes: PurposePolicy, trigger?: LegacyAmbientTrigger): AmbientJudgeConversion {
  const language = purposes.defaults.ambient;
  const languageFallbacks = purposes.defaults.ambientFallbacks ?? [];
  const decision = purposes.decisions?.ambient;
  const tConfidence = triggerConfidence(trigger);
  const tMode = triggerMode(trigger);
  const rows: AmbientJudgeMigrationRow[] = [];
  const notes: AmbientJudgeMigrationNote[] = [];
  const result: { -readonly [K in keyof AmbientJudgePolicy]: AmbientJudgePolicy[K] } = {};
  const set = <K extends keyof AmbientJudgePolicy>(field: K, value: AmbientJudgePolicy[K] | undefined, from: string) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return;
    result[field] = value;
    rows.push(Object.freeze({ field, value: Array.isArray(value) ? Object.freeze([...value]) : value as string | number, from }));
  };
  const active = decision?.mode === 'active' && decision.profile !== undefined;
  const shadow = decision?.mode === 'shadow' && decision.profile !== undefined;
  if (active) {
    set('profile', decision.profile, 'purposes.decisions.ambient.profile');
    // The former language judge must not disappear: it is now the first fallback (D5.2).
    const chain = [...new Set([...(language ? [language] : []), ...languageFallbacks])].filter(id => id !== decision.profile);
    set('fallbacks', chain, 'purposes.ambient (language) + purposes.ambient.fallbacks');
    if (language) notes.push({ code: 'language-judge-became-fallback', value: language });
    else notes.push({ code: 'inherited-chat-not-added' });
    const threshold = Math.max(tConfidence ?? DEFAULT_AMBIENT_MIN_CONFIDENCE, decision.minConfidence ?? 0);
    set('minConfidence', threshold, 'max(ai.trigger.ambient.minConfidence, purposes.decisions.ambient.minConfidence)');
    notes.push({ code: 'threshold-max', value: threshold });
    set('mode', tMode, 'ai.trigger.ambient.mode');
    set('timeoutMs', decision.timeoutMs, 'purposes.decisions.ambient.timeoutMs');
  } else {
    set('profile', language, 'purposes.ambient (language)');
    if (language) set('fallbacks', languageFallbacks, 'purposes.ambient.fallbacks');
    if (shadow) {
      set('compare', decision.profile, 'purposes.decisions.ambient.profile');
      set('timeoutMs', decision.timeoutMs, 'purposes.decisions.ambient.timeoutMs');
      if (decision.minConfidence !== undefined) notes.push({ code: 'shadow-threshold-dropped', value: decision.minConfidence });
    } else if (decision?.profile !== undefined) {
      notes.push({ code: 'off-profile-not-migrated', value: decision.profile });
    }
    set('minConfidence', tConfidence, 'ai.trigger.ambient.minConfidence');
    set('mode', tMode, 'ai.trigger.ambient.mode');
  }
  return Object.freeze({ ambient: Object.freeze(result), rows: Object.freeze(rows), notes: Object.freeze(notes) });
}

/** `purposes` without the legacy ambient fields (the stored form after the migration). */
export function withoutLegacyAmbientJudge(purposes: PurposePolicy): PurposePolicy {
  const { ambient: _ambient, ambientFallbacks: _fallbacks, ...defaults } = purposes.defaults;
  const decisions = purposes.decisions ? Object.fromEntries(Object.entries(purposes.decisions).filter(([task]) => task !== 'ambient')) : undefined;
  const { decisions: _decisions, ...rest } = purposes;
  return Object.freeze({ ...rest, defaults: Object.freeze(defaults),
    ...(decisions && Object.keys(decisions).length ? { decisions: Object.freeze(decisions) } : {}) }) as PurposePolicy;
}

/** Where the policy in effect comes from. */
export type AmbientJudgePolicySource =
  /** `purposes.ambient` is stored. */
  | 'stored'
  /** Legacy stored fields, converted in memory (the migration has not run or failed). */
  | 'legacy'
  /** Nothing stored: defaults, with the retired yml keys while no migration has stored a policy. */
  | 'default';

/**
 * The policy a judgment uses (D5.3): the stored `purposes.ambient`; otherwise the legacy fields
 * converted by the same table; otherwise only the yml `minConfidence` / `mode` (until a migration
 * stores them). `trigger` is ignored once `purposes.ambient` is stored.
 */
export function effectiveAmbientJudgePolicy(purposes: PurposePolicy, trigger?: LegacyAmbientTrigger): Readonly<{
  policy: AmbientJudgePolicy; source: AmbientJudgePolicySource;
}> {
  if (purposes.ambient) return Object.freeze({ policy: purposes.ambient, source: 'stored' });
  if (hasLegacyAmbientJudgeFields(purposes)) return Object.freeze({ policy: convertLegacyAmbientJudge(purposes, trigger).ambient, source: 'legacy' });
  const tConfidence = triggerConfidence(trigger), tMode = triggerMode(trigger);
  return Object.freeze({ policy: Object.freeze({ ...(tConfidence !== undefined ? { minConfidence: tConfidence } : {}), ...(tMode ? { mode: tMode } : {}) }),
    source: 'default' });
}

/**
 * The judge chain `[profile, ...fallbacks]` of the policy in effect, or — without a `profile` —
 * the deployment chat model and its fallbacks (`inheritedFrom: 'chat'`, D1.7).
 */
export function ambientJudgeChain(purposes: PurposePolicy): Readonly<{ ids: readonly string[]; inheritedFrom?: 'chat' }> {
  const { policy } = effectiveAmbientJudgePolicy(purposes);
  if (policy.profile) return Object.freeze({ ids: Object.freeze([policy.profile, ...(policy.fallbacks ?? [])]) });
  const chat = purposes.defaults.chat;
  return Object.freeze({ ids: Object.freeze(chat ? [chat, ...(purposes.defaults.chatFallbacks ?? [])] : []), inheritedFrom: 'chat' });
}

/** Engage only when the judge chose to engage with at least `minConfidence` (D4): one rule for both model kinds. */
export function ambientJudgeWouldSpeak(judgment: Readonly<{ engage: boolean; confidence: number }>, minConfidence: number): boolean {
  return judgment.engage === true && judgment.confidence >= minConfidence;
}
