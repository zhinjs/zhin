/**
 * Agent Mesh MCP tools — agent.delegate_task / query_status / get_result / cancel_task
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENT_MESH_TOOL_NAMES } from '@zhin.js/core';
import { z } from 'zod';
import { getAgentDispatcher } from '../orchestrator/agent-dispatcher.js';
import { getDelegationProcessor } from '../orchestrator/delegation-processor.js';
import { getOrchestrationRuntime } from '../orchestration-runtime-registry.js';

export { AGENT_MESH_TOOL_NAMES };

const artifactSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  mime: z.string().optional(),
});

export function registerAgentMeshTools(server: McpServer): void {
  server.registerTool(
    'agent.delegate_task',
    {
      description: '委托任务给本实例主 Agent（远程 Mesh 入口）',
      inputSchema: {
        title: z.string().describe('任务标题'),
        description: z.string().describe('任务描述'),
        acceptance_criteria: z.string().optional().describe('验收标准'),
        artifacts: z.array(artifactSchema).optional().describe('显式附件'),
      },
    },
    async (args) => {
      const processor = getDelegationProcessor();
      if (!processor) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'DelegationProcessor not ready' }) }],
          isError: true,
        };
      }
      const result = await processor.createDelegation({
        title: args.title,
        description: args.description,
        acceptance_criteria: args.acceptance_criteria,
        artifacts: args.artifacts,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            remote_task_id: result.remote_task_id,
            run_id: result.run_id,
            status: 'pending',
          }),
        }],
      };
    },
  );

  server.registerTool(
    'agent.query_status',
    {
      description: '查询委托任务状态',
      inputSchema: {
        task_id: z.string().describe('remote_task_id'),
      },
    },
    async (args) => {
      const runtime = getOrchestrationRuntime();
      const dispatcher = getAgentDispatcher();
      const task = await runtime?.service.repositoryHandle.getTask(args.task_id);
      if (task) dispatcher.syncTaskFromRecord(task);
      const result = dispatcher.getResult(args.task_id);
      const status = task?.status ?? (result ? (result.success ? 'completed' : 'failed') : 'unknown');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            task_id: args.task_id,
            status,
            error: task?.error ?? result?.error,
          }),
        }],
      };
    },
  );

  server.registerTool(
    'agent.get_result',
    {
      description: '获取已完成委托任务的结果',
      inputSchema: {
        task_id: z.string().describe('remote_task_id'),
      },
    },
    async (args) => {
      const runtime = getOrchestrationRuntime();
      const dispatcher = getAgentDispatcher();
      const task = await runtime?.service.repositoryHandle.getTask(args.task_id);
      if (task) dispatcher.syncTaskFromRecord(task);
      const result = dispatcher.getResult(args.task_id);
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not completed' }) }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            task_id: args.task_id,
            success: result.success,
            summary: result.summary,
            error: result.error,
          }),
        }],
      };
    },
  );

  server.registerTool(
    'agent.cancel_task',
    {
      description: '取消 pending/running 委托任务',
      inputSchema: {
        task_id: z.string().describe('remote_task_id'),
      },
    },
    async (args) => {
      const runtime = getOrchestrationRuntime();
      if (!runtime) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Orchestration not ready' }) }],
          isError: true,
        };
      }
      const task = await runtime.service.repositoryHandle.getTask(args.task_id);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }],
          isError: true,
        };
      }
      if (task.status === 'completed' || task.status === 'skipped') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task already finished' }) }],
          isError: true,
        };
      }
      await runtime.service.repositoryHandle.updateTaskStatus(args.task_id, 'failed', {
        error: 'cancelled via agent.cancel_task',
        finished_at: Date.now(),
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ task_id: args.task_id, status: 'cancelled' }),
        }],
      };
    },
  );
}
