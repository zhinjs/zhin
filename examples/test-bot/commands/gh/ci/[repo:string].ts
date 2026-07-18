import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '查看 CI / Actions 状态',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.listWorkflowRuns(String(params.repo), 10);
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const runs = (r.data as {
      workflow_runs?: Array<{
        conclusion?: string;
        status?: string;
        id: number;
        display_title?: string;
        head_branch?: string;
      }>;
    }).workflow_runs || [];
    if (!runs.length) return '暂无 CI 记录';
    return runs.map((run) => {
      const icon = run.conclusion === 'success'
        ? 'ok'
        : run.conclusion === 'failure'
          ? 'fail'
          : run.status === 'in_progress'
            ? 'running'
            : 'pending';
      return `[${icon}] #${run.id} ${run.display_title}\n   ${run.head_branch} | ${run.status}${run.conclusion ? '/' + run.conclusion : ''}`;
    }).join('\n\n');
  },
});
