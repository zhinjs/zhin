export interface GroupSuiteConfig {
  welcome: string;
  recallNotify: boolean;
  keywordReply: boolean;
  noticeAdapters: string[];
  basePointsMin: number;
  basePointsMax: number;
  streakBonus: number;
  streakCap: number;
  rankSize: number;
  statsRetentionDays: number;
  analysisDays: number;
  autoAnalysisEnabled: boolean;
  autoAnalysisCron: string;
  analysisGroups: string[];
  analysisGroupsBlock: string[];
  analysisMaxMessages: number;
  teachMaxPerGroup: number;
  teachCooldownMs: number;
  teachAllowRegex: boolean;
  teachPageSize: number;
}

export const DEFAULT_GROUP_SUITE_CONFIG: GroupSuiteConfig = {
  welcome: '欢迎新成员加入本群！',
  recallNotify: true,
  keywordReply: false,
  noticeAdapters: ['icqq'],
  basePointsMin: 10,
  basePointsMax: 30,
  streakBonus: 5,
  streakCap: 50,
  rankSize: 10,
  statsRetentionDays: 90,
  analysisDays: 1,
  autoAnalysisEnabled: false,
  autoAnalysisCron: '0 0 9 * * *',
  analysisGroups: [],
  analysisGroupsBlock: [],
  analysisMaxMessages: 500,
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
    noticeAdapters: raw?.noticeAdapters?.length
      ? [...raw.noticeAdapters]
      : [...DEFAULT_GROUP_SUITE_CONFIG.noticeAdapters],
    analysisGroups: raw?.analysisGroups ? [...raw.analysisGroups] : [],
    analysisGroupsBlock: raw?.analysisGroupsBlock ? [...raw.analysisGroupsBlock] : [],
  };
}
