/**
 * @zhin.js/devteam - 反馈工具
 *
 * 管理用户反馈的收集和查询
 */

import { ZhinTool } from 'zhin.js';
import type { UserFeedback } from '../types.js';

/**
 * 创建反馈管理工具集
 */
export function createFeedbackTools(feedbacks: UserFeedback[]) {
  const collectFeedback = new ZhinTool('devteam_collect_feedback')
    .desc('收集用户反馈。当用户描述了需求、建议、Bug 或意见时，使用此工具记录')
    .keyword('反馈', '需求', '建议', 'bug', '意见', '功能请求')
    .tag('devteam', 'feedback')
    .param('userId', { type: 'string', description: '反馈用户 ID' }, true)
    .param('platform', { type: 'string', description: '消息来源平台' }, true)
    .param('content', { type: 'string', description: '用户反馈内容（完整原文或摘要）' }, true)
    .execute(async (args) => {
      const feedback: UserFeedback = {
        userId: args.userId as string,
        platform: args.platform as string,
        content: args.content as string,
        collectedAt: Date.now(),
        processed: false,
      };
      feedbacks.push(feedback);
      return {
        success: true,
        message: `已记录用户反馈 (共 ${feedbacks.length} 条)`,
        feedbackIndex: feedbacks.length - 1,
      };
    });

  const listFeedback = new ZhinTool('devteam_list_feedback')
    .desc('列出未处理的用户反馈，用于项目经理整理需求')
    .keyword('用户反馈', '反馈列表', '未处理反馈')
    .tag('devteam', 'feedback')
    .param('unprocessedOnly', { type: 'boolean', description: '是否只显示未处理的反馈（默认 true）' })
    .execute(async (args) => {
      const onlyUnprocessed = args.unprocessedOnly !== false;
      const filtered = onlyUnprocessed
        ? feedbacks.filter(f => !f.processed)
        : feedbacks;

      return {
        total: filtered.length,
        feedbacks: filtered.map(f => ({
          userId: f.userId,
          platform: f.platform,
          content: f.content.substring(0, 500),
          collectedAt: new Date(f.collectedAt).toISOString(),
          processed: f.processed,
          requirementIssue: f.requirementIssue,
        })),
      };
    });

  const markFeedbackProcessed = new ZhinTool('devteam_mark_feedback_processed')
    .desc('标记用户反馈已处理，并关联到需求')
    .keyword('处理反馈', '标记已处理')
    .tag('devteam', 'feedback')
    .param('feedbackIndex', { type: 'number', description: '反馈在列表中的索引' }, true)
    .param('requirementIssue', { type: 'number', description: '关联的需求 Issue 编号（如果形成了需求）' })
    .execute(async (args) => {
      const index = args.feedbackIndex as number;
      if (index < 0 || index >= feedbacks.length) {
        return { success: false, error: '索引超出范围' };
      }

      feedbacks[index].processed = true;
      if (args.requirementIssue) {
        feedbacks[index].requirementIssue = args.requirementIssue as number;
      }

      return {
        success: true,
        message: `反馈 #${index} 已标记为已处理` +
          (args.requirementIssue ? `，关联到需求 #${args.requirementIssue}` : ''),
      };
    });

  return [collectFeedback, listFeedback, markFeedbackProcessed];
}
