import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  AIService,
  AssistantEventIngress,
  JobWorker,
  ScheduleJobEngine,
  bootstrapAssistantHome,
  createNotificationRouter,
  createScheduleJobStoreFromConfig,
  createScheduleTools,
  createTaskExecutor,
  demoteScheduleCreator,
  loadAssistantProfileFile,
  parseJobNotify,
  pruneStaleProfileCronJobs,
  resolveAssistantConfig,
  resolveAssistantDefaultsConfig,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  validateAssistantProfile,
  type AssistantConfig,
  type BootstrapAssistantHomeResult,
  type ProactiveSendSource,
  type ScheduleActivityEvent,
  type ScheduleInvocationContext,
  type ScheduleTurnExecutionRequest,
  type TurnOutcome,
  type TurnRequest,
} from '@zhin.js/agent';
import {
  AgentRuntime,
  ZhinAgent,
  type AgentTraceRecorder,
  type AssistantRuntimeHandle,
} from '@zhin.js/agent/runtime';
import { createRuntimeProactiveOutbound, observeAgentTurnTrace } from './agent-runtime-factory.js';

const logger = getLogger('agent');

/**
 * Persist schedule-jobs.json + schedule_* tools for Plugin Runtime Agent Host.
 * When `assistant.enabled`, also sync profile routines and register Event Ingress.
 */
export function createAssistantScheduleRuntime(
  agent: ZhinAgent,
  service: AIService,
  runtime: AgentRuntime,
  im: ImRuntime,
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  trace: AgentTraceRecorder,
): {
  tools: ReturnType<typeof createScheduleTools>;
  dispose: () => Promise<void>;
  assistantEnabled: boolean;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined;
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void;
  assistantRuntime: AssistantRuntimeHandle | null;
} {
  const dataDir = join(projectRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const defaults = resolveAssistantDefaultsConfig(assistantCfg.defaults);
  let defaultNotify = defaults.notify;
  if (defaultNotify) {
    try {
      defaultNotify = parseJobNotify(defaultNotify);
    } catch {
      defaultNotify = undefined;
    }
  }

  let callHaServiceImpl: ((service: string, target?: string, data?: unknown) => Promise<void>) | undefined;
  const bindCallHaService = (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => {
    callHaServiceImpl = fn;
  };

  const proactiveOutbound = createRuntimeProactiveOutbound(im);
  const notificationRouter = createNotificationRouter({
    resolveAdapter: () => undefined,
    sendIm: async (notify, content, source) => {
      await proactiveOutbound.send({
        scene: notify.target.scene,
        source: (source ?? 'scheduled') as ProactiveSendSource,
      }, content);
    },
    callHaService: async (service, target, data) => {
      if (callHaServiceImpl) {
        await callHaServiceImpl(service, target, data);
        return;
      }
      logger.info(formatCompact({
        op: 'job_notify_ha_stub',
        service,
        target,
      }));
    },
  });
  const executor = createTaskExecutor({
    turn: createRuntimeScheduleTurnPort(runtime, service, projectRoot, trace),
    config: agent.config,
    activity: createScheduleActivityPort(agent),
    dataDir,
    resolveAdapter: () => undefined,
    router: notificationRouter,
    defaultNotify,
  });

  const store = createScheduleJobStoreFromConfig(dataDir, {
    defaultNotify,
  });
  const jobWorker = new JobWorker({
    executor,
    queue: assistantCfg.queue,
  });
  const jobEngine = new ScheduleJobEngine({
    store,
    worker: jobWorker,
    notifyOnFailure: defaults.notifyOnFailure,
    router: notificationRouter,
    defaultNotify,
  });

  const scheduleManager = {
    scheduleFeature: {
      getStatus: () => [],
    },
    engine: jobEngine,
    previewTask: (prompt: string, context: ScheduleInvocationContext, options?: { activityFeedback?: boolean }) =>
      executor.preview(prompt, context, options),
  };

  let assistantRuntime: AssistantRuntimeHandle | null = null;
  if (assistantCfg.enabled) {
    const ingress = new AssistantEventIngress({
      store,
      engine: jobEngine,
      eventsConfig: assistantCfg.events,
    });
    assistantRuntime = {
      events: {
        isEnabled: () => ingress.isEnabled(),
        handle: (body) => ingress.handle(body),
      },
      jobs: {
        list: () => jobEngine.listJobs(),
        add: (job) => jobEngine.addJob(job),
        remove: (id) => jobEngine.removeJob(id),
        pause: (id) => jobEngine.pauseJob(id),
        resume: (id) => jobEngine.resumeJob(id),
      },
    };
    void (async () => {
      const profile = await loadAssistantProfileFile(projectRoot, assistantCfg.profile);
      if (profile) {
        for (const err of validateAssistantProfile(profile)) {
          logger.warn(formatCompact({ assistant_profile: err }));
        }
      }
      await syncProfileHeartbeatToStore(store, profile);
      await syncProfileRoutinesToStore(store, profile);
      await pruneStaleProfileCronJobs(store, profile);
      jobEngine.load();
    })().catch((error) => {
      logger.warn(formatCompact({
        op: 'assistant_profile_load_fail',
        error: error instanceof Error ? error.message : String(error),
      }));
      jobEngine.load();
    });
    logger.info(formatCompact({
      op: 'agent_host_assistant',
      enabled: true,
      events: ingress.isEnabled(),
      profile: assistantCfg.profile?.enabled === true,
    }));
  } else {
    jobEngine.load();
  }

  const tools = createScheduleTools(scheduleManager);

  return {
    tools,
    assistantEnabled: assistantCfg.enabled,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    assistantRuntime,
    // assistant / schedule-manager 注册随 generation lifecycle 反注册（provide 时挂接）
    dispose: async () => {
      jobEngine.unload();
      await jobWorker.stop();
      await executor.dispose();
    },
  };
}

function createRuntimeScheduleTurnPort(
  runtime: AgentRuntime,
  service: AIService,
  projectRoot: string,
  trace: AgentTraceRecorder,
) {
  return Object.freeze({
    execute: async (input: ScheduleTurnExecutionRequest): Promise<TurnOutcome> => {
      const binding = input.agent
        ? service.getBindingRegistry().getBinding(input.agent)
        : service.getBindingRegistry().requireZhinBinding();
      if (!binding) throw new Error(`Schedule Agent binding not found: ${input.agent}`);
      const creator = input.createdBy ? demoteScheduleCreator(input.createdBy) : undefined;
      const request: TurnRequest = {
        identity: { traceId: input.executionId, turnId: input.executionId },
        origin: { kind: 'schedule', jobId: input.jobId },
        intent: { kind: 'new' },
        principal: {
          subjectId: creator?.userId ?? 'schedule',
          ...(creator?.name ? { displayName: creator.name } : {}),
          roles: [...(creator?.roles ?? [])],
        },
        input: { text: input.prompt },
        session: { key: `schedule:${input.jobId}` },
        policy: {
          permissions: [],
          unattended: true,
          network: {
            enabled: true,
            httpsOnly: true,
            allowedDomains: [...input.security.allowedDomains],
          },
          shell: { preset: input.security.execPreset },
          filesystem: { workspaceRoot: projectRoot },
        },
        execution: {
          kind: 'schedule',
          executionPlan: input.executionPlan,
          createdBy: input.createdBy,
          security: {
            execPreset: input.security.execPreset,
            allowedDomains: [...input.security.allowedDomains],
          },
        },
        signal: input.signal,
        ports: {},
      };
      return runtime.execute(rootPluginId(), request, {
        binding,
        mcpServers: binding.mcpServers,
        ...(binding.name === 'zhin' ? {} : { agent: binding.name }),
      }, observeAgentTurnTrace(trace, request, input.onTurnEvent));
    },
  });
}

function createScheduleActivityPort(agent: ZhinAgent) {
  return Object.freeze({
    publish: async (event: ScheduleActivityEvent) => {
      const payload = scheduleActivityPayload(event);
      if (!payload) return;
      await agent.getEventEmitter().dispatch(`schedule.${event.phase}`, payload);
    },
  });
}

function scheduleActivityPayload(event: ScheduleActivityEvent) {
  const previewIm = event.previewSource?.origin.kind === 'im' ? event.previewSource.origin : undefined;
  const notifyIm = event.notify.channel === 'im' ? event.notify.target.scene : undefined;
  const address = previewIm
    ? {
        platform: previewIm.platform,
        endpointKey: previewIm.endpoint,
        sceneId: previewIm.sceneId,
        scope: previewIm.scope,
        messageId: previewIm.messageId,
      }
    : notifyIm
      ? {
          platform: notifyIm.platform,
          endpointKey: notifyIm.endpointKey,
          sceneId: notifyIm.sceneId,
          scope: notifyIm.kind,
        }
      : undefined;
  if (!address) return undefined;
  return {
    sessionId: event.previewSource?.sessionKey ?? `schedule:${event.job.id}`,
    source: 'zhin-agent' as const,
    mode: 'text' as const,
    userId: event.job.createdBy?.userId ?? 'schedule',
    ...address,
    hookContext: {
      scheduleJobId: event.job.id,
      ...(event.job.createdBy ? { scheduleCreatedBy: event.job.createdBy } : {}),
      ...(event.previewSource ? { schedulePreview: true } : {}),
      scheduleActivityFeedback: true,
      ...(event.job.executionPlan ? { scheduleExecutionPlan: event.job.executionPlan } : {}),
    },
  };
}

export async function createAssistantHomeRuntime(
  projectRoot: string,
  assistantRaw: AssistantConfig | undefined,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  bindCallHaService: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void,
  defaultNotify: ReturnType<typeof parseJobNotify> | undefined,
): Promise<{
  tools: BootstrapAssistantHomeResult['tools'];
  dispose: () => void;
  homeActive: boolean;
  watchActive: boolean;
}> {
  const assistantCfg = resolveAssistantConfig(assistantRaw);
  const result = await bootstrapAssistantHome({
    homeRaw: assistantCfg.home,
    profile: assistantCfg.profile,
    projectRoot,
    notificationRouter,
    defaultNotify,
    bindCallHaService,
    log: (payload) => logger.info(formatCompact(payload)),
  });
  return {
    tools: result.tools,
    dispose: result.dispose,
    homeActive: result.homeActive,
    watchActive: result.watchActive,
  };
}
