import { rootPluginId } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { JobWorker } from '../../src/assistant/job-worker.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { createTaskExecutor } from '../../src/task-executor.js';
import { ScheduleExecutionDomainImpl } from '../../src/schedule-domain/execution-domain.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { createNativeFileToolFeatures } from '../../src/plugin-runtime/native-file-tools.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { ScheduleHistoryEvent, ScheduleHistoryObserver } from '../../src/schedule-domain/execution-history.js';

export const scheduleFixtureJob: ScheduleJob = {
  id: 'replay-test', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
  action: { kind: 'agent', prompt: 'Perform the fixture task' }, notify: { channel: 'silent' },
  createdAt: 1, updatedAt: 1, state: {}, activityFeedback: true,
};

export function createScheduleExecutionFixture(options: {
  readonly readOnly?: boolean;
  readonly tool?: ToolCapability;
  readonly workspace?: string;
  readonly failAfterTool?: boolean;
  readonly journalFailure?: boolean;
  readonly auditFailure?: boolean;
  readonly activityFailure?: boolean;
  readonly historyFailure?: boolean;
  readonly history?: ScheduleHistoryObserver;
  readonly afterTool?: (signal: AbortSignal) => Promise<void>;
} = {}) {
  let effects = 0;
  const events: ScheduleHistoryEvent[] = [];
  const actual = options.tool ?? { owner: rootPluginId(), name: 'fixture_tool', qualifiedName: 'fixture_tool',
    source: '/fixture/tools/action.ts', description: 'Fixture action', requiresApproval: 'never',
    ...(options.readOnly ? { readOnly: true } : {}),
    execute: vi.fn(async () => { effects++; return 'Action complete'; }),
  } as ToolCapability;
  let turns = 0;
  const domain = new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG,
    auditLogger: { write: async () => { if (options.auditFailure) throw new Error('audit unavailable'); } },
    turn: { execute: async request => {
      turns++;
      const turn = createTurnIngress({
        identity: { rootId: 'root', generation: 1, traceId: request.executionId, turnId: request.executionId },
        origin: { kind: 'schedule', jobId: request.jobId }, intent: { kind: 'new' },
        execution: { kind: 'schedule', security: { execPreset: 'readonly', allowedDomains: [] } },
        principal: { subjectId: 'schedule', roles: ['user'] }, input: { text: request.prompt },
        session: { key: `schedule:${request.jobId}` },
        policy: { permissions: [], unattended: true,
          network: { enabled: true, httpsOnly: true, allowedDomains: [] }, shell: { preset: 'readonly' },
          filesystem: { workspaceRoot: options.workspace ?? process.cwd(), access: options.workspace ? 'workspace-write' : 'read-only' } },
        capabilities: { tools: [actual.name], skills: [] }, signal: request.signal,
        ports: { operationEvidence: request.operationEvidence, journal: { append: event => {
          request.onTurnEvent(event);
          if (options.journalFailure && event.type === 'tool_result') throw new Error('required journal unavailable');
        } } },
      });
      const outcome = await new TurnToolRuntime(turn, [actual]).execute(actual.name, options.workspace
        ? { file_path: join(options.workspace, 'result.txt'), content: 'Confirmed filesystem mutation' } : {}, 'call-1');
      if (outcome.status !== 'completed') throw new Error(`Fixture tool did not complete: ${JSON.stringify(outcome)}`);
      request.onTurnEvent({ type: 'usage', usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 } });
      await options.afterTool?.(request.signal);
      if (options.failAfterTool && turns === 1) throw new Error('Model continuation failed');
      return { status: 'completed', output: [{ type: 'text', content: 'Final output' }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } };
    } },
  });
  const history = { observe: async (event: ScheduleHistoryEvent) => {
    events.push(event); if (options.historyFailure) throw new Error('history unavailable');
    await options.history?.observe(event);
  } };
  const executor = createTaskExecutor({ domain, router: createNotificationRouter({ resolveAdapter: () => undefined }), history,
    activity: { publish: async () => { if (options.activityFailure) throw new Error('activity unavailable'); } } });
  const worker = new JobWorker({ executor, history, queue: { maxRetries: 1, maxConcurrency: 1, defaultTimeoutMs: 5_000 } });
  return { worker, executor, events, effects: () => effects, turns: () => turns };
}

/** A real file-action owner with an explicit authorized workspace; no provider or platform IO. */
export function createFixtureFileWriter(): ToolCapability {
  const definition = createNativeFileToolFeatures().find(feature => feature.name === 'write_file')!.definition;
  return { owner: rootPluginId(), name: 'fixture_file_writer', qualifiedName: 'fixture_file_writer',
    source: '/fixture/tools/native-write.ts', description: 'Native file fixture', requiresApproval: 'never',
    execute: ((input: unknown, invocation: unknown) => definition.execute(input as Record<string, unknown>, invocation as never)) as ToolCapability['execute'] };
}
