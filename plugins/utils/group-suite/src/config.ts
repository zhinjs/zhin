import { Schema } from "zhin.js";

/** 扁平 groupSuite 配置（单层字段，默认值覆盖多数场景） */
export const groupSuiteSchema = Schema.object({
  welcome: Schema.string()
    .default("欢迎新成员加入本群！")
    .description("入群欢迎语"),
  recallNotify: Schema.boolean()
    .default(true)
    .description("群消息撤回时是否提示"),
  keywordReply: Schema.boolean()
    .default(false)
    .description("内置关键词回复（默认关闭，用 teach 问答）"),
  noticeAdapters: Schema.list(Schema.string())
    .default(["icqq"])
    .description("处理 notice 的适配器（欢迎/撤回）"),

  basePointsMin: Schema.number().default(10).min(1).max(100),
  basePointsMax: Schema.number().default(30).min(1).max(200),
  streakBonus: Schema.number().default(5).min(0).max(100),
  streakCap: Schema.number().default(50).min(0).max(500),

  rankSize: Schema.number()
    .default(10)
    .min(3)
    .max(50)
    .description("签到排行与消息统计排行显示人数"),
  statsRetentionDays: Schema.number().default(90).min(7).max(365),

  analysisDays: Schema.number().default(1).min(1).max(30),
  autoAnalysisEnabled: Schema.boolean().default(false),
  autoAnalysisCron: Schema.string().default("0 9 * * *"),
  analysisGroups: Schema.list(Schema.string())
    .default([])
    .description("启用群日报的群 ID 白名单（空=不限制）"),
  analysisGroupsBlock: Schema.list(Schema.string())
    .default([])
    .description("禁用群日报的群 ID"),
  analysisFormat: Schema.string()
    .default("text")
    .description("日报格式 text | image"),
  analysisMaxMessages: Schema.number().default(500).min(100).max(5000),

  teachMaxPerGroup: Schema.number().default(200).min(1).max(1000),
  teachCooldownMs: Schema.number().default(3000).min(0).max(60000),
  teachAllowRegex: Schema.boolean().default(true),
  teachPageSize: Schema.number().default(10).min(5).max(50),
});

export type GroupSuiteConfig = {
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
  analysisFormat: string;
  analysisMaxMessages: number;
  teachMaxPerGroup: number;
  teachCooldownMs: number;
  teachAllowRegex: boolean;
  teachPageSize: number;
};
