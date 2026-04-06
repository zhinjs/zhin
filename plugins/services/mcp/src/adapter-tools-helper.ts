/**
 * MCP 适配器工具注册辅助
 *
 * 提供 registerGroupManagementMcpTools() 函数：
 * 将 Adapter 上的 IGroupManagement 方法自动注册为 MCP 工具。
 *
 * 使用 JSON Schema 格式，无需 zod 依赖。
 */
import type { McpToolRegistry, McpToolDef, JsonSchemaProperty } from "./index.js";
import type { IGroupManagement } from "zhin.js";

interface GroupMethodMcpSpec {
  method: keyof IGroupManagement;
  toolSuffix: string;
  description: string;
  extraProperties: Record<string, JsonSchemaProperty>;
  extraRequired?: string[];
}

const GROUP_METHOD_MCP_SPECS: GroupMethodMcpSpec[] = [
  {
    method: "kickMember",
    toolSuffix: "kick_member",
    description: "将成员踢出群/服务器",
    extraProperties: { user_id: { type: "string", description: "目标用户 ID" } },
    extraRequired: ["user_id"],
  },
  {
    method: "muteMember",
    toolSuffix: "mute_member",
    description: "禁言或解除禁言群成员（duration=0 解除禁言）",
    extraProperties: {
      user_id: { type: "string", description: "目标用户 ID" },
      duration: { type: "number", description: "禁言时长(秒)，0=解除，默认600" },
    },
    extraRequired: ["user_id"],
  },
  {
    method: "setMemberNickname",
    toolSuffix: "set_nickname",
    description: "设置群成员的群昵称/名片",
    extraProperties: {
      user_id: { type: "string", description: "目标用户 ID" },
      nickname: { type: "string", description: "新的群昵称" },
    },
    extraRequired: ["user_id", "nickname"],
  },
  {
    method: "setAdmin",
    toolSuffix: "set_admin",
    description: "设置或取消群管理员",
    extraProperties: {
      user_id: { type: "string", description: "目标用户 ID" },
      enable: { type: "boolean", description: "true=设置管理员，false=取消" },
    },
    extraRequired: ["user_id"],
  },
  {
    method: "listMembers",
    toolSuffix: "list_members",
    description: "获取群/服务器成员列表",
    extraProperties: {},
  },
  {
    method: "banMember",
    toolSuffix: "ban_member",
    description: "永久封禁成员（拉入黑名单）",
    extraProperties: {
      user_id: { type: "string", description: "目标用户 ID" },
      reason: { type: "string", description: "封禁原因" },
    },
    extraRequired: ["user_id"],
  },
  {
    method: "unbanMember",
    toolSuffix: "unban_member",
    description: "解除封禁，将成员从黑名单中移除",
    extraProperties: { user_id: { type: "string", description: "目标用户 ID" } },
    extraRequired: ["user_id"],
  },
  {
    method: "setGroupName",
    toolSuffix: "set_group_name",
    description: "修改群/服务器名称",
    extraProperties: { name: { type: "string", description: "新群名称" } },
    extraRequired: ["name"],
  },
  {
    method: "muteAll",
    toolSuffix: "mute_all",
    description: "开启或关闭全员禁言",
    extraProperties: { enable: { type: "boolean", description: "true=开启，false=解除" } },
  },
  {
    method: "getGroupInfo",
    toolSuffix: "get_group_info",
    description: "获取群/服务器基本信息",
    extraProperties: {},
  },
];

/**
 * 将 Adapter 的 IGroupManagement 方法批量注册为 MCP 工具。
 * 返回清理函数。
 *
 * @param mcp - McpToolRegistry 实例
 * @param adapter - 实现了 IGroupManagement 的适配器实例
 * @param prefix - 工具名前缀（如 'icqq'、'discord'）
 */
export function registerGroupManagementMcpTools(
  mcp: McpToolRegistry,
  adapter: IGroupManagement & { bots: Map<string, any> },
  prefix: string,
): () => void {
  const registered: string[] = [];

  for (const spec of GROUP_METHOD_MCP_SPECS) {
    const fn = adapter[spec.method];
    if (typeof fn !== "function") continue;

    const toolName = `${prefix}_${spec.toolSuffix}`;
    const boundFn = fn.bind(adapter);

    const properties: Record<string, JsonSchemaProperty> = {
      bot_id: { type: "string", description: "Bot ID" },
      scene_id: { type: "string", description: "群/服务器 ID" },
      ...spec.extraProperties,
    };

    mcp.addTool({
      name: toolName,
      description: `${spec.description} (${prefix})`,
      parameters: {
        type: "object",
        properties,
        required: ["bot_id", "scene_id", ...(spec.extraRequired || [])],
      },
      handler: async (args: Record<string, any>) => {
        const { bot_id, scene_id, ...rest } = args;
        const methodArgs = buildArgs(spec.method, bot_id, scene_id, rest);
        return (boundFn as (...a: any[]) => Promise<any>)(...methodArgs);
      },
    });
    registered.push(toolName);
  }

  return () => {
    for (const name of registered) {
      mcp.removeTool(name);
    }
  };
}

function buildArgs(
  method: keyof IGroupManagement,
  botId: string,
  sceneId: string,
  rest: Record<string, any>,
): any[] {
  switch (method) {
    case "kickMember":        return [botId, sceneId, rest.user_id];
    case "muteMember":        return [botId, sceneId, rest.user_id, rest.duration ?? 600];
    case "setMemberNickname": return [botId, sceneId, rest.user_id, rest.nickname];
    case "setAdmin":          return [botId, sceneId, rest.user_id, rest.enable ?? true];
    case "listMembers":       return [botId, sceneId];
    case "banMember":         return [botId, sceneId, rest.user_id, rest.reason];
    case "unbanMember":       return [botId, sceneId, rest.user_id];
    case "setGroupName":      return [botId, sceneId, rest.name];
    case "muteAll":           return [botId, sceneId, rest.enable ?? true];
    case "getGroupInfo":      return [botId, sceneId];
    default:                  return [botId, sceneId, ...Object.values(rest)];
  }
}
