/**
 * run_spec_dry_run — Planner tool: manifest + vitest dry-run.
 */
import type { ToolParametersSchema, ToolResult } from '@zhin.js/core'
import type { AgentTool } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import {
  defaultMissionSpecPaths,
  validateMissionSpecBundle,
} from '../orchestrator/mission-spec.js';

const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: '编排 run ID' },
    spec_paths: {
      type: 'array',
      items: { type: 'string' },
      description: '可选；默认 .zhin/missions/<runId>/spec.test.ts',
    },
  },
  required: ['run_id'],
};

class RunSpecDryRunTool extends BuiltinBaseTool {
  readonly name = 'run_spec_dry_run';
  readonly description =
    '运行 Validation Spec dry-run（manifest + vitest）。Planner/Spec 阶段使用；通过后写入 spec_dry_run_passed。';
  readonly parameters = PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const runId = String(args.run_id ?? '').trim();
    if (!runId) return '请提供 run_id';

    const svc = getOrchestrationService();
    if (!svc) return 'OrchestrationService 未初始化';

    const run = await svc.repositoryHandle.getRun(runId);
    if (!run) return `Run ${runId} 不存在`;

    const defaults = defaultMissionSpecPaths(runId);
    const specPaths = Array.isArray(args.spec_paths)
      ? args.spec_paths.map(String)
      : [defaults.specTestPath, defaults.manifestPath];

    const result = await validateMissionSpecBundle(runId, specPaths, true);
    if (!result.ok) {
      return `Spec dry-run 失败：${result.reason ?? 'unknown'}`;
    }

    await svc.patchMissionState(runId, {
      validation_spec_paths: specPaths.filter((p) => p.endsWith('.test.ts') || p.includes('spec')),
      assertion_count: result.assertionCount,
      spec_dry_run_passed: true,
      phase: 'develop',
    });

    return (
      `Spec dry-run 通过：assertions=${result.assertionCount}\n`
      + `paths=${specPaths.join(', ')}`
    );
  }
}

export function createRunSpecDryRunTool(): AgentTool {
  return new RunSpecDryRunTool().toTool() as AgentTool;
}
