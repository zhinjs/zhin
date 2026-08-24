import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expectedPhases = [
  'queued',
  'active',
  'thinking',
  'schedule_start',
  'schedule_finish',
  'schedule_error',
] as const;
const expectedTypes = ['reaction', 'message', 'typing', 'none'] as const;
const expectedScenes = ['private', 'group', 'channel'] as const;
const expectedScheduleKeys = ['start', 'finish', 'error'] as const;

function stringLiterals(source: string, typeName: string): string[] {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`, 'u'));
  if (!match) throw new Error(`Cannot find ${typeName}`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);
}

function propertyStringLiterals(source: string, propertyName: string): string[] {
  const match = source.match(new RegExp(`\\b${propertyName}\\?:\\s*([^;]+);`, 'u'));
  if (!match) throw new Error(`Cannot find ${propertyName}`);
  return [...match[1].matchAll(/'([^']*)'/gu)].map((entry) => entry[1]);
}

describe('source-owned configuration enums', () => {
  it('documents the Console Agent Studio run-policy enums from source', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'plugins/adapters/sandbox/src/run-config.ts'),
      'utf8',
    );
    const safetyModes = stringLiterals(source, 'SandboxSafetyMode');
    const approvalModes = stringLiterals(source, 'SandboxApprovalMode');
    expect(safetyModes).toEqual(['read-only', 'workspace-write', 'danger-full-access']);
    expect(approvalModes).toEqual(['ask', 'deny', 'allow']);

    for (const relative of ['docs/console/index.md', 'docs/en/console/index.md']) {
      const page = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      for (const value of [...safetyModes, ...approvalModes]) {
        expect(page).toContain(`\`${value}\``);
      }
      expect(page).toContain('`workingDirectory`');
      expect(page).toContain('`networkAccess`');
    }
  });

  it('keeps Agent policy enums aligned across source, Runtime Schema, and generated docs', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'packages/im/agent/src/config/zhin-agent-config.ts'),
      'utf8',
    );
    const agentConfigSource = source.slice(source.indexOf('export interface ZhinAgentConfig'));
    const queueModeSource = fs.readFileSync(
      path.join(repoRoot, 'packages/im/ai/src/llm/types/queue-mode.ts'),
      'utf8',
    );
    const schema = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'packages/im/runtime/src/host-config-schema.json'),
      'utf8',
    ));
    const agentSchema = schema.properties.ai.properties.agent.properties;
    const contracts = [
      ['inboundQueue.groupMode', stringLiterals(source, 'InboundGroupQueueMode'), agentSchema.inboundQueue.properties.groupMode.enum],
      ['execSecurity', propertyStringLiterals(agentConfigSource, 'execSecurity'), agentSchema.execSecurity.enum],
      ['execPreset', propertyStringLiterals(agentConfigSource, 'execPreset'), agentSchema.execPreset.enum],
      ['execApprovalMode', stringLiterals(source, 'ExecApprovalMode'), agentSchema.execApprovalMode.enum],
      ['toolExecution', propertyStringLiterals(agentConfigSource, 'toolExecution'), agentSchema.toolExecution.enum],
      ['modelSizeHint', propertyStringLiterals(agentConfigSource, 'modelSizeHint'), agentSchema.modelSizeHint.enum],
      ['promptCacheRetention', propertyStringLiterals(agentConfigSource, 'promptCacheRetention'), agentSchema.promptCacheRetention.enum],
      ['steeringMode', stringLiterals(queueModeSource, 'QueueMode'), agentSchema.steeringMode.enum],
      ['followUpMode', stringLiterals(queueModeSource, 'QueueMode'), agentSchema.followUpMode.enum],
    ] as const;

    for (const [field, sourceValues, schemaValues] of contracts) {
      expect(schemaValues, field).toEqual(sourceValues);
    }
    for (const field of [
      'subagentExecApprovalMode',
      'workerExecApprovalMode',
      'taskExecApprovalMode',
    ]) {
      expect(agentSchema[field].enum).toEqual(stringLiterals(source, 'ExecApprovalMode'));
    }
    expect(agentSchema.outputSchema.anyOf[1].enum).toEqual(
      propertyStringLiterals(agentConfigSource, 'outputSchema'),
    );
    expect(agentSchema.schedule.properties.security.properties.execPreset.enum).toEqual(
      propertyStringLiterals(source, 'execPreset'),
    );

    const inlineLiteralFields = [...agentConfigSource.matchAll(/^ {2}(\w+)\?:([^\n]+);$/gmu)]
      .filter((entry) => entry[2].includes("'"))
      .map((entry) => entry[1]);
    expect(inlineLiteralFields).toEqual([
      'execSecurity',
      'execPreset',
      'toolExecution',
      'modelSizeHint',
      'promptCacheRetention',
      'outputSchema',
    ]);

    for (const relative of [
      'docs/configuration/generated.md',
      'docs/en/configuration/generated.md',
    ]) {
      const generated = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      for (const [field, sourceValues] of contracts) {
        expect(generated).toContain(`\`ai.agent.${field}\``);
        for (const value of sourceValues) expect(generated).toContain(JSON.stringify(value));
      }
      expect(generated).toContain('`ai.agent.outputSchema`');
      expect(generated).toContain('`ai.agent.schedule.security.execPreset`');
    }
  });

  it('keeps activity feedback enums aligned across source and the published Schema', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'packages/im/agent/src/activity-feedback/types.ts'),
      'utf8',
    );
    const typingSource = fs.readFileSync(
      path.join(repoRoot, 'packages/im/agent/src/typing-indicator/index.ts'),
      'utf8',
    );
    const serviceConfigSource = fs.readFileSync(
      path.join(repoRoot, 'plugins/services/activity-feedback/src/config.ts'),
      'utf8',
    );
    const schema = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'plugins/services/activity-feedback/schema.json'),
      'utf8',
    ));

    expect(stringLiterals(source, 'ActivityFeedbackPhase')).toEqual(expectedPhases);
    expect(stringLiterals(source, 'ActivitySceneType')).toEqual(expectedScenes);
    expect(stringLiterals(typingSource, 'TypingIndicatorType')).toEqual(expectedTypes);
    expect(Object.keys(schema.$defs.activityFeedback.properties.phases.properties)).toEqual(expectedPhases);
    expect(schema.$defs.phaseConfig.properties.type.enum).toEqual(expectedTypes);
    expect(Object.keys(schema.$defs.scenePhases.properties)).toEqual(expectedScenes);

    const scheduleKeys = serviceConfigSource
      .match(/phases\?: Partial<Record<([\s\S]*?),\s*import/u)?.[1]
      ?.matchAll(/'([^']+)'/gu);
    expect(scheduleKeys && [...scheduleKeys].map((entry) => entry[1]).sort()).toEqual(
      [...expectedScheduleKeys].sort(),
    );
    expect(Object.keys(schema.$defs.scheduleFeedback.properties.phases.properties).sort()).toEqual(
      [...expectedScheduleKeys].sort(),
    );
  });

  it('explains every activity feedback enum to beginners in both languages', () => {
    const pages = [
      fs.readFileSync(path.join(repoRoot, 'docs/advanced/activity-feedback.md'), 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'docs/en/advanced/activity-feedback.md'), 'utf8'),
    ];
    for (const page of pages) {
      for (const phase of expectedPhases) expect(page).toContain(`\`${phase}\``);
      for (const type of expectedTypes) expect(page).toContain(`\`${type}\``);
      for (const scene of expectedScenes) expect(page).toContain(`\`${scene}\``);
      for (const key of expectedScheduleKeys) expect(page).toContain(`\`${key}\``);
      expect(page).toMatch(/when|何时/iu);
      expect(page).toMatch(/recommend|建议/iu);
    }
  });

  it('projects default and dynamic activity feedback paths into the generated reference', () => {
    for (const relative of [
      'docs/configuration/generated.md',
      'docs/en/configuration/generated.md',
    ]) {
      const generated = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      expect(generated).toContain('`plugins.activity-feedback.defaults.phases.queued`');
      expect(generated).toContain('`plugins.activity-feedback.defaults.phases.active.private.type`');
      expect(generated).toContain('`plugins.activity-feedback.platforms.<platform>.phases.active.private.type`');
      expect(generated).toContain('`plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.type`');
      expect(generated).toContain('"reaction"');
      expect(generated).toContain('"none"');
    }
  });
});
