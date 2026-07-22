import { Adapter, type Plugin, type ConfigFeature } from "@zhin.js/core";
import { toConsoleChannelParent } from "../endpoint-channel.js";
import { broadcastSse } from "../sse-hub.js";
import type { ConsoleRpcContext } from "./context.js";
import {
  collectEndpointsListWithPending,
  findPluginByConfigKey,
  getConfigFilePath,
  getPluginKeys,
  resolveConfigKey,
} from "./console-utils.js";
import { listEnvFiles, resolveEnvPath } from "./project-fs.js";
import {
  buildProjectFileTree,
  readProjectFile,
  saveProjectFile,
} from "./project-files.js";
import { handleDbRpc } from "./handlers-db.js";
import { assertDemoRpcAllowed } from "@zhin.js/host-router/router";
import { parseJobNotify, type JobNotify } from "@zhin.js/agent";
import {
  endpointSendResult,
  normalizeConsoleRpcMessage,
} from '@zhin.js/console-protocol';

function reply(ctx: ConsoleRpcContext, payload: Record<string, unknown>) {
  ctx.emit(payload);
}

function parseCronNotify(message: Record<string, unknown>): JobNotify {
  const raw = message.notify;
  if (raw && typeof raw === "object" && raw !== null && "channel" in raw) {
    return parseJobNotify(raw);
  }
  const ch = String(message.notifyChannel ?? message.notify_channel ?? "silent").toLowerCase();
  if (ch === "im") {
    throw new Error("IM notify requires notify.target (IMDeliveryTarget)");
  }
  if (ch === "log") return { channel: "log" };
  return { channel: "silent" };
}

type ScheduleFeatureLike = {
  getStatus(): Array<{
    id: string;
    kind: string;
    expression?: string;
    running: boolean;
    nextExecution: Date | null;
    plugin: string;
  }>;
};

function getScheduleFeature(root: Plugin): ScheduleFeatureLike | undefined {
  const schedule = root.inject("schedule");
  return schedule && typeof (schedule as ScheduleFeatureLike).getStatus === "function"
    ? (schedule as ScheduleFeatureLike)
    : undefined;
}

function mapMemoryScheduleStatus(scheduleFeature: ScheduleFeatureLike) {
  return scheduleFeature.getStatus().map((s) => ({
    type: "memory" as const,
    id: s.id,
    kind: s.kind,
    expression: s.expression,
    running: s.running,
    nextExecution: s.nextExecution?.toISOString() ?? null,
    plugin: s.plugin,
  }));
}

async function listPersistentScheduleJobs() {
  const { getScheduleManager } = await import("@zhin.js/agent");
  const m = getScheduleManager();
  if (!m?.engine) return [];
  return (await m.engine.listJobs()).map((j) => ({
    type: "persistent" as const,
    ...j,
  }));
}

async function withPersistentScheduleEngine(
  requestId: number | undefined,
  ctx: ConsoleRpcContext,
  run: (engine: {
    addJob: (job: Record<string, unknown>) => Promise<unknown>;
    removeJob: (id: string) => Promise<boolean>;
    pauseJob: (id: string) => Promise<boolean>;
    resumeJob: (id: string) => Promise<boolean>;
  }) => Promise<void>,
): Promise<boolean> {
  const { getScheduleManager } = await import("@zhin.js/agent");
  const m = getScheduleManager();
  if (!m?.engine) {
    reply(ctx, { requestId, error: "持久化调度引擎不可用" });
    return true;
  }
  await run(m.engine as never);
  return true;
}

/** Console RPC（返回是否已处理）。 */
export async function handleCoreRpc(
  message: Record<string, unknown>,
  ctx: ConsoleRpcContext,
): Promise<boolean> {
  message = normalizeConsoleRpcMessage(message);
  const type = String(message.type ?? "");
  const requestId = message.requestId as number | undefined;
  const pluginName = message.pluginName as string | undefined;
  const { root, webServer, authScope = "full" } = ctx;

  if (authScope === "demo") {
    const denied = assertDemoRpcAllowed(type);
    if (denied) {
      reply(ctx, { requestId, error: denied });
      return true;
    }
  }

  if (type.startsWith("db:")) {
    return handleDbRpc(message, ctx);
  }

  switch (type) {
    case "ping":
      reply(ctx, { type: "pong", requestId });
      return true;

    case "entries:get":
      reply(ctx, { requestId, data: Object.values(webServer.entries ?? {}) });
      return true;

    case "config:get-yaml":
      try {
        const filePath = getConfigFilePath(ctx);
        const yaml = ctx.projectFs.exists(filePath) ? ctx.projectFs.readText(filePath) : "";
        reply(ctx, { requestId, data: { yaml, pluginKeys: getPluginKeys(root) } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to read config: ${(error as Error).message}` });
      }
      return true;

    case "config:save-yaml": {
      try {
        const yaml = message.yaml;
        if (typeof yaml !== "string") {
          reply(ctx, { requestId, error: "yaml field is required" });
          return true;
        }
        const filePath = getConfigFilePath(ctx);
        ctx.projectFs.writeText(filePath, yaml);
        const configService = root.inject("config") as ConfigFeature;
        const loader = configService.configs.get(configService.primaryFile);
        if (loader) loader.load();
        reply(ctx, { requestId, data: { success: true, message: "配置已保存，需重启生效" } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to save config: ${(error as Error).message}` });
      }
      return true;
    }

    case "config:get":
      try {
        const configService = root.inject("config") as ConfigFeature;
        const rawConfig = configService.getRaw<Record<string, unknown>>(configService.primaryFile);
        if (!pluginName) {
          reply(ctx, { requestId, data: rawConfig });
        } else {
          const configKey = resolveConfigKey(root, pluginName);
          reply(ctx, { requestId, data: rawConfig[configKey] || {} });
        }
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to get config: ${(error as Error).message}` });
      }
      return true;

    case "config:get-all":
      try {
        const configService = root.inject("config") as ConfigFeature;
        const rawConfig = configService.getRaw<Record<string, unknown>>(configService.primaryFile);
        const allConfigs: Record<string, unknown> = { ...rawConfig };
        const schemaService = root.inject("schema");
        if (schemaService) {
          for (const [pName, configKey] of schemaService.getPluginKeyMap()) {
            if (pName !== configKey) {
              allConfigs[pName] = rawConfig[configKey] || {};
            }
          }
        }
        reply(ctx, { requestId, data: allConfigs });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to get all configs: ${(error as Error).message}` });
      }
      return true;

    case "config:set":
      try {
        const data = message.data;
        if (!pluginName) {
          reply(ctx, { requestId, error: "Plugin name is required" });
          return true;
        }
        const configKey = resolveConfigKey(root, pluginName);
        const configService = root.inject("config") as ConfigFeature;
        const loader = configService.configs.get(configService.primaryFile);
        if (!loader) {
          reply(ctx, { requestId, error: "Config file not loaded" });
          return true;
        }
        loader.patchKey(configKey, data);

        broadcastSse({ type: "config:updated", data: { pluginName, config: data } });

        const schemaService = root.inject("schema");
        const reloadable = schemaService?.isReloadable?.(pluginName) ?? false;

        if (reloadable) {
          const target = findPluginByConfigKey(root, pluginName);
          if (target) {
            try {
              await target.reload();
              reply(ctx, { requestId, data: { success: true, reloaded: true } });
            } catch (reloadErr) {
              reply(ctx, {
                requestId,
                data: {
                  success: true,
                  reloaded: false,
                  message: `配置已保存，但重载失败: ${(reloadErr as Error).message}`,
                },
              });
            }
          } else {
            reply(ctx, { requestId, data: { success: true, reloaded: false, message: "配置已保存" } });
          }
        } else {
          reply(ctx, {
            requestId,
            data: { success: true, reloaded: false, message: "配置已保存，需重启进程才能生效" },
          });
        }
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to set config: ${(error as Error).message}` });
      }
      return true;

    case "schema:get":
      try {
        const schemaService = root.inject("schema");
        const schema = pluginName && schemaService ? schemaService.get(pluginName) : null;
        reply(ctx, { requestId, data: schema ? schema.toJSON() : null });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to get schema: ${(error as Error).message}` });
      }
      return true;

    case "schema:get-all":
      try {
        const schemaService = root.inject("schema");
        const schemas: Record<string, unknown> = {};
        if (schemaService) {
          for (const record of schemaService.items) {
            if (record.key && record.schema) {
              schemas[record.key] = record.schema.toJSON();
            }
          }
          for (const [pName, configKey] of schemaService.getPluginKeyMap()) {
            if (pName !== configKey && schemas[configKey]) {
              schemas[pName] = schemas[configKey];
            }
          }
        }
        reply(ctx, { requestId, data: schemas });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to get all schemas: ${(error as Error).message}` });
      }
      return true;

    case "files:tree":
      try {
        reply(ctx, { requestId, data: { tree: buildProjectFileTree(ctx.projectFs) } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to build file tree: ${(error as Error).message}` });
      }
      return true;

    case "files:read": {
      try {
        const fp = message.filePath as string;
        if (!fp) {
          reply(ctx, { requestId, error: "filePath is required" });
          return true;
        }
        const { content, size } = readProjectFile(ctx.projectFs, fp);
        reply(ctx, { requestId, data: { content, size } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to read file: ${(error as Error).message}` });
      }
      return true;
    }

    case "files:save": {
      try {
        const fp = message.filePath as string;
        const fileContent = message.content;
        if (!fp) {
          reply(ctx, { requestId, error: "filePath is required" });
          return true;
        }
        if (typeof fileContent !== "string") {
          reply(ctx, { requestId, error: "content field is required" });
          return true;
        }
        saveProjectFile(ctx.projectFs, fp, fileContent);
        reply(ctx, { requestId, data: { success: true, message: `文件已保存: ${fp}` } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to save file: ${(error as Error).message}` });
      }
      return true;
    }

    case "env:list":
      try {
        reply(ctx, { requestId, data: { files: listEnvFiles(ctx.projectFs) } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to list env files: ${(error as Error).message}` });
      }
      return true;

    case "env:get":
      try {
        const filename = message.filename as string;
        const envPath = filename ? resolveEnvPath(ctx.projectFs, filename) : null;
        if (!envPath) {
          reply(ctx, { requestId, error: `Invalid env file: ${filename}` });
          return true;
        }
        const content = ctx.projectFs.exists(envPath) ? ctx.projectFs.readText(envPath) : "";
        reply(ctx, { requestId, data: { content } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to read env file: ${(error as Error).message}` });
      }
      return true;

    case "env:save":
      try {
        const filename = message.filename as string;
        const content = message.content as string;
        const envPath = filename ? resolveEnvPath(ctx.projectFs, filename) : null;
        if (!envPath) {
          reply(ctx, { requestId, error: `Invalid env file: ${filename}` });
          return true;
        }
        ctx.projectFs.writeText(envPath, content);
        reply(ctx, { requestId, data: { success: true } });
      } catch (error) {
        reply(ctx, { requestId, error: `Failed to save env file: ${(error as Error).message}` });
      }
      return true;

    case "endpoint.list": {
      try {
        const endpointsWithPending = await collectEndpointsListWithPending(root);
        reply(ctx, { requestId, data: { endpoints: endpointsWithPending } });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "endpoint.info": {
      try {
        const d = message;
        const adapter = d.$adapter as string;
        const endpointId = d.$endpoint as string;
        if (!adapter || !endpointId) {
          reply(ctx, { requestId, error: "$adapter and $endpoint required" });
          return true;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        if (!(ad instanceof Adapter)) {
          reply(ctx, { requestId, error: "adapter not found" });
          return true;
        }
        const endpoint = ad.endpoints.get(endpointId);
        if (!endpoint) {
          reply(ctx, { requestId, error: "endpoint not found" });
          return true;
        }
        reply(ctx, {
          requestId,
          data: {
            name: endpointId,
            adapter: String(adapter),
            connected: !!endpoint.$connected,
            status: endpoint.$connected ? "online" : "offline",
          },
        });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "endpoint.send_message": {
      try {
        const d = message;
        const adapter = d.$adapter as string;
        const endpointId = d.$endpoint as string;
        const id = d.$channel_id as string;
        const msgType = d.$channel_type as string;
        const content = d.$content;
        if (!adapter || !endpointId || !id || !msgType || content === undefined) {
          reply(ctx, { requestId, error: "$adapter, $endpoint, $channel_id, $channel_type, $content required" });
          return true;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        if (!(ad instanceof Adapter)) {
          reply(ctx, { requestId, error: "adapter not found" });
          return true;
        }
        const normalized =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
              : String(content);
        const parent = toConsoleChannelParent(
          d.$parent as { type?: string; id?: string; name?: string } | undefined,
        );
        const messageId = await ad.sendMessage({
          context: adapter,
          endpoint: endpointId,
          id: String(id),
          type: msgType as "private" | "group" | "channel",
          ...(parent ? { parent } : {}),
          content: normalized,
        });
        reply(ctx, { requestId, data: endpointSendResult(messageId) });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "schedule:list": {
      try {
        const scheduleFeature = getScheduleFeature(root);
        if (!scheduleFeature) {
          reply(ctx, { requestId, error: "调度服务不可用" });
          return true;
        }
        const memory = mapMemoryScheduleStatus(scheduleFeature);
        const persistent = await listPersistentScheduleJobs();
        reply(ctx, { requestId, data: { memory, persistent } });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "schedule:add": {
      try {
        return await withPersistentScheduleEngine(requestId, ctx, async (engine) => {
          const {
            addScheduleJob,
            generateScheduleJobId,
            parseScheduleAddFromRpcMessage,
          } = await import("@zhin.js/agent");
          const input = parseScheduleAddFromRpcMessage(message as Record<string, unknown>);
          if ("error" in input) {
            reply(ctx, { requestId, error: input.error });
            return true;
          }
          const record = await addScheduleJob(engine, {
            ...input,
            id: generateScheduleJobId(),
          });
          reply(ctx, { requestId, data: record });
        });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "schedule:remove": {
      try {
        const id = message.id as string;
        if (!id) {
          reply(ctx, { requestId, error: "缺少任务 id" });
          return true;
        }
        return await withPersistentScheduleEngine(requestId, ctx, async (engine) => {
          const ok = await engine.removeJob(id);
          reply(ctx, { requestId, data: { success: ok } });
        });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "schedule:pause": {
      try {
        const id = message.id as string;
        if (!id) {
          reply(ctx, { requestId, error: "缺少任务 id" });
          return true;
        }
        return await withPersistentScheduleEngine(requestId, ctx, async (engine) => {
          const ok = await engine.pauseJob(id);
          reply(ctx, { requestId, data: { success: ok } });
        });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    case "schedule:resume": {
      try {
        const id = message.id as string;
        if (!id) {
          reply(ctx, { requestId, error: "缺少任务 id" });
          return true;
        }
        return await withPersistentScheduleEngine(requestId, ctx, async (engine) => {
          const ok = await engine.resumeJob(id);
          reply(ctx, { requestId, data: { success: ok } });
        });
      } catch (error) {
        reply(ctx, { requestId, error: (error as Error).message });
      }
      return true;
    }

    default:
      return false;
  }
}
