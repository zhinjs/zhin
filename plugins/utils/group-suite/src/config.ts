export interface GroupSuiteConfig {
  keywordReply: boolean;
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
  basePointsMin: 10,
  basePointsMax: 30,
  streakBonus: 5,
  streakCap: 50,
  rankSize: 10,
  teachMaxPerGroup: 200,
  teachCooldownMs: 3000,
  teachAllowRegex: true,
  teachPageSize: 10,
};

export function resolveGroupSuiteConfig(
  raw: Partial<GroupSuiteConfig> | undefined,
): GroupSuiteConfig {
  return {
    ...DEFAULT_GROUP_SUITE_CONFIG,
    ...raw,
  };
}
