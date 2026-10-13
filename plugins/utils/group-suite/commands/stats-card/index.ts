import { defineCommand } from 'zhin.js/command';
import { segment } from 'zhin.js';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';
import { flushStatsBuffer, queryStats, resolveGroupId } from '../../src/stats-lib.js';
import { buildStatsRankReportData } from '../../src/stats-data.js';
import { buildStatsRankHtml, STATS_REPORT_CANVAS } from '../../src/stats-card.js';
import { todayStr, resolveSender } from '../../src/shared-runtime.js';

export default defineCommand<GroupSuiteConfig, SendContent, Message>({
  description: '查看今日群消息统计卡片（不支持图片时显示文本）',
  permit: ['group()'],
  async execute(context) {
    if (!context.input) throw new Error('Group statistics require an incoming message');
    const runtime = resolveGroupSuiteRuntime(context);
    await flushStatsBuffer(runtime);
    const stats = await queryStats(resolveGroupId(context.input), todayStr(), runtime);
    const data = buildStatsRankReportData(stats, '今日本群消息统计',
      resolveGroupSuiteConfig(context.config).rankSize, resolveSender(context.input).id);
    return segment.html({ html: await buildStatsRankHtml(data), width: 540,
      backgroundColor: STATS_REPORT_CANVAS, fileName: 'group-stats.png' });
  },
});
