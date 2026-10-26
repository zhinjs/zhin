import { Schema } from 'zhin.js';

export const DEFAULT_ANSWERS_CONFIG = Object.freeze({
  dailyStable: false,
  timezone: 'Asia/Shanghai',
  quizTimeoutSeconds: 120,
  enableDrivingQuiz: true,
});

/** Authoring declaration; scripts/sync-plugin-config-schemas.mjs generates the packaged schema.json for Runtime and Console. */
export const answersConfig = Schema.object({
  dailyStable: Schema.boolean().default(DEFAULT_ANSWERS_CONFIG.dailyStable).description('同一用户同一天问同一个问题时，答案之书给出相同答案').i18n({"en": {"description": "Return the same Book of Answers response when the same user asks the same question on the same day."}}).effect('reload'),
  timezone: Schema.string().default(DEFAULT_ANSWERS_CONFIG.timezone).description('dailyStable 判断「同一天」所用的 IANA 时区').i18n({"en": {"description": "IANA timezone used by dailyStable to determine the day."}}).effect('reload'),
  quizTimeoutSeconds: Schema.number().min(15).max(600).step(1).default(DEFAULT_ANSWERS_CONFIG.quizTimeoutSeconds).description('出题后等待作答的秒数，超时题目作废').i18n({"en": {"description": "Seconds to wait for a quiz answer; the question expires afterward."}}).effect('reload'),
  enableDrivingQuiz: Schema.boolean().default(DEFAULT_ANSWERS_CONFIG.enableDrivingQuiz).description('启用「科目一」交规小测（原创题面，仅供娱乐参考）').i18n({"en": {"description": "Enable the original driving-theory quiz, for entertainment and reference only."}}).effect('reload'),
});

export type AnswersConfig = Schema.Output<typeof answersConfig>;

/** Missing fields fall back to defaults so commands stay usable when Runtime passes a partial view. */
export function resolveAnswersConfig(config: Partial<AnswersConfig> | undefined): AnswersConfig {
  return { ...DEFAULT_ANSWERS_CONFIG, ...(config ?? {}) } as AnswersConfig;
}
