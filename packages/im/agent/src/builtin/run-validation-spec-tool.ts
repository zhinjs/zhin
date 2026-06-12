/**
 * run_validation_spec — Validator-only tool (ADR 0011 D3).
 */
import type { ToolParametersSchema, ToolResult } from '@zhin.js/core'
import type { AgentTool } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import {
  getValidationSpecRunner,
  parseValidationOutput,
} from '../orchestrator/mission-spec.js';

export type { ValidationSpecRunner } from '../orchestrator/mission-spec.js';
export {
  defaultValidationSpecRunner,
  setValidationSpecRunnerForTests,
  resetValidationSpecRunner,
  getValidationSpecRunner,
} from '../orchestrator/mission-spec.js';

const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: '编排 run ID' },
  },
  required: ['run_id'],
};

class RunValidationSpecTool extends BuiltinBaseTool {
  readonly name = 'run_validation_spec';
  readonly description =
    '运行 Mission Validation Spec（vitest）。Validator 专用；不得配合 read_file 查看实现。';
  readonly parameters = PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const runId = String(args.run_id ?? '').trim();
    if (!runId) return '请提供 run_id';

    const svc = getOrchestrationService();
    if (!svc) return 'OrchestrationService 未初始化';

    const state = await svc.getMissionState(runId);
    if (!state || state.validation_spec_paths.length === 0) {
      return 'Mission State 中无 validation_spec_paths';
    }

    const execResult = await getValidationSpecRunner()(state.validation_spec_paths);
    const validation = parseValidationOutput(execResult.stdout, execResult.stderr, execResult.ok);

    await svc.patchMissionState(runId, {
      last_validation: validation,
      phase: validation.failed === 0 ? 'done' : 'validate',
    });

    if (execResult.ok && validation.failed === 0) {
      return (
        `Validation Spec 通过：passed=${validation.passed}\n`
        + execResult.stdout.slice(0, 2000)
      );
    }
    return (
      `Validation Spec 失败：passed=${validation.passed} failed=${validation.failed}\n`
      + execResult.stderr.slice(0, 2000)
    );
  }
}

export function createRunValidationSpecTool(): AgentTool {
  return new RunValidationSpecTool().toTool() as AgentTool;
}
