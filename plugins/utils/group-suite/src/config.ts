import { definePluginStore, type DeliveryTarget } from 'zhin.js';
import { normalizeWelcomeConversations } from './welcome-scope.js';

export interface GroupSuiteConfig {
  keywordReply: boolean;
  /** Explicitly volatile keywords for demos without a persistent Database Host. */
  ephemeralKeywords: boolean;
  /** Empty disables group member welcomes. {name} and {id} are literal placeholders. */
  welcomeMessage: string;
  /** Omitted preserves all groups; [] disables welcomes. Each address matches exactly. */
  welcomeConversations?: readonly DeliveryTarget[];
  basePointsMin: number;
  basePointsMax: number;
  streakBonus: number;
  streakCap: number;
  rankSize: number;
  teachMaxPerGroup: number;
  teachCooldownMs: number;
  teachAllowRegex: boolean;
  teachPageSize: number;
}

export const DEFAULT_GROUP_SUITE_CONFIG: GroupSuiteConfig = {
  keywordReply: false,
  ephemeralKeywords: false,
  welcomeMessage: '',
  basePointsMin: 10,
  basePointsMax: 30,
  streakBonus: 5,
  streakCap: 50,
  rankSize: 10,
  teachMaxPerGroup: 200,
  teachCooldownMs: 3000,
  teachAllowRegex: false,
  teachPageSize: 10,
};

export function resolveGroupSuiteConfig(
  raw: Partial<GroupSuiteConfig> | undefined,
): GroupSuiteConfig {
  return {
    ...DEFAULT_GROUP_SUITE_CONFIG,
    ...raw,
    ...(raw?.welcomeConversations === undefined ? {} : {
      welcomeConversations: normalizeWelcomeConversations(raw.welcomeConversations),
    }),
  };
}

/** Effective configuration per message / notice (ADR 0050 / 0055): global < adapter < endpoint < conversation. */
export interface GroupSuiteConfigResolver {
  configFor(target: unknown): Readonly<Partial<GroupSuiteConfig>>;
}
export const groupSuiteConfigStore = definePluginStore<GroupSuiteConfigResolver>(
  'zhin.group-suite.config', 'Layered group-suite configuration for one conversation');

/**
 * Settings for one capability call: the conversation's effective config when the resolver is
 * provided (Plugin setup), else the global view. `target` is the message or notice being handled.
 */
export function groupSuiteConfigFor(context: {
  readonly config?: Partial<GroupSuiteConfig>;
  readonly has?: (token: typeof groupSuiteConfigStore) => boolean;
  readonly use: (token: typeof groupSuiteConfigStore) => GroupSuiteConfigResolver;
}, target: unknown): GroupSuiteConfig {
  const resolver = target !== undefined && context.has?.(groupSuiteConfigStore) ? context.use(groupSuiteConfigStore) : undefined;
  return resolveGroupSuiteConfig({ ...(context.config ?? {}), ...(resolver?.configFor(target) ?? {}) });
}
