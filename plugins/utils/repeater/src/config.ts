import { Schema } from 'zhin.js';

export const DEFAULT_REPEATER_CONFIG = Object.freeze({
  threshold: 3,
  cooldown: 30_000,
  maxLength: 200,
});

/** Authoring declaration; scripts/sync-plugin-config-schemas.mjs generates the packaged schema.json for Runtime and Console. */
export const repeaterConfig = Schema.object({
  threshold: Schema.number().min(2).max(10).step(1).default(DEFAULT_REPEATER_CONFIG.threshold).description('触发复读的最少人数').i18n({"en": {"description": "Minimum distinct users needed to trigger repetition."}}).effect('reload'),
  cooldown: Schema.number().min(5_000).max(300_000).default(DEFAULT_REPEATER_CONFIG.cooldown).description('同一群冷却时间 (ms)').i18n({"en": {"description": "Cooldown for the same group, in milliseconds."}}).effect('reload'),
  maxLength: Schema.number().min(10).max(1_000).step(1).default(DEFAULT_REPEATER_CONFIG.maxLength).description('消息长度上限').i18n({"en": {"description": "Maximum message length."}}).effect('reload'),
});

export type RepeaterConfig = Schema.Output<typeof repeaterConfig>;
