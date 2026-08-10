/**
 * bootstrapAssistantHome — Plugin Runtime 可注入装配（无 getPlugin）
 */
import type { Tool } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/ai';
import {
  resolveAssistantHomeConfig,
  isAssistantHomeActive,
  type AssistantHomeConfig,
} from './home-config.js';
import { HaHomeBackend } from './domains/ha-home-backend.js';
import { HomeFacade } from './home-facade.js';
import { createHomeTools } from './home-tools.js';
import {
  HomeStateWatch,
  buildWatchEntityMap,
  buildWsUrl,
} from './domains/home-state-watch.js';
import { loadAssistantProfileFile, mergeProfileDeviceAliases } from './profile-loader.js';
import { validateHomeMcpServer } from './home-mcp-bridge.js';
import type { NotificationRouter } from './notification-router.js';
import type { JobNotify } from './types.js';
import { resolveEffectiveNotify, parseJobNotify } from './notification-router.js';

export interface BootstrapAssistantHomeOptions {
  homeRaw?: AssistantHomeConfig;
  /** assistant.profile for device alias merge */
  profile?: import('./profile-types.js').AssistantProfileConfig;
  ai?: AIConfig;
  projectRoot: string;
  notificationRouter: NotificationRouter;
  /** assistant.defaults.notify — required for watch */
  defaultNotify?: JobNotify;
  /** Assign after backend created so JobNotify channel:ha works */
  bindCallHaService?: (fn: (service: string, target?: string, data?: unknown) => Promise<void>) => void;
  log?: (payload: Record<string, unknown>) => void;
}

export interface BootstrapAssistantHomeResult {
  tools: Tool[];
  dispose: () => void;
  homeActive: boolean;
  watchActive: boolean;
  backend: HaHomeBackend | null;
}

function zhinToolsToCoreTools(tools: ReturnType<typeof createHomeTools>): Tool[] {
  return tools.map((tool) => {
    const plain = tool.toTool();
    return {
      name: plain.name,
      description: plain.description,
      parameters: plain.parameters as Tool['parameters'],
      source: 'builtin',
      execute: plain.execute as Tool['execute'],
      tags: plain.tags,
      keywords: plain.keywords,
    } satisfies Tool;
  });
}

function isDeliverableImNotify(notify: JobNotify | undefined): notify is Extract<JobNotify, { channel: 'im' }> {
  if (!notify || notify.channel !== 'im') return false;
  const scene = notify.target?.scene;
  return Boolean(scene?.platform && scene.endpointId && scene.sceneId && scene.kind);
}

export async function bootstrapAssistantHome(
  options: BootstrapAssistantHomeOptions,
): Promise<BootstrapAssistantHomeResult> {
  const log = options.log ?? ((p) => { /* noop */ void p; });
  const empty: BootstrapAssistantHomeResult = {
    tools: [],
    dispose: () => {},
    homeActive: false,
    watchActive: false,
    backend: null,
  };

  if (!isAssistantHomeActive(options.homeRaw)) return empty;

  const profile = await loadAssistantProfileFile(options.projectRoot, options.profile);
  const homeCfg = resolveAssistantHomeConfig({
    ...options.homeRaw,
    aliases: mergeProfileDeviceAliases(profile, options.homeRaw?.aliases),
  });

  const mcpWarn = validateHomeMcpServer(homeCfg, options.ai);
  if (mcpWarn) log({ assistant_home_mcp: mcpWarn });

  const backend = new HaHomeBackend(homeCfg);
  options.bindCallHaService?.((service, target, data) =>
    backend.callHaNotifyService(service, target, data),
  );

  const facade = new HomeFacade({ backend, policy: homeCfg.policy });
  const tools = zhinToolsToCoreTools(createHomeTools({ facade }));

  let watch: HomeStateWatch | undefined;
  let watchActive = false;
  const watchAliases = homeCfg.watch;
  if (watchAliases.length > 0 && homeCfg.restUrl && homeCfg.restToken) {
    let notify: JobNotify | undefined = options.defaultNotify;
    if (notify) {
      try {
        notify = resolveEffectiveNotify(parseJobNotify(notify), undefined);
      } catch {
        notify = undefined;
      }
    }
    if (!isDeliverableImNotify(notify)) {
      log({
        op: 'ha_ws_watch_skip',
        reason: 'defaults_notify_not_im',
      });
    } else {
      const entityToAlias = buildWatchEntityMap(homeCfg.aliases, watchAliases);
      watch = new HomeStateWatch({
        wsUrl: buildWsUrl(homeCfg.restUrl),
        token: homeCfg.restToken,
        entityToAlias,
        debounceMs: homeCfg.debounceMs,
        notify,
        router: options.notificationRouter,
      });
      watch.start();
      watchActive = entityToAlias.size > 0;
      log({
        ha_ws_watch: watchActive,
        aliases: entityToAlias.size,
        debounceMs: homeCfg.debounceMs,
      });
    }
  }

  log({
    assistant_home: true,
    aliases: Object.keys(homeCfg.aliases).length,
    mcpServer: homeCfg.mcpServer,
  });

  return {
    tools,
    homeActive: true,
    watchActive,
    backend,
    dispose: () => {
      watch?.dispose();
    },
  };
}
