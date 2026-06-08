/**
 * OpenAPI schemas & route metadata for GET /api/introspection/*
 */
import type { RouteMeta } from "./route-meta.js";

export const INTROSPECTION_OPENAPI_SCHEMAS: Record<string, Record<string, unknown>> = {
  IntrospectionQuery: {
    type: "object",
    properties: {
      page: {
        type: "integer",
        minimum: 1,
        default: 1,
        description: "页码（从 1 开始）",
      },
      pageSize: {
        type: "integer",
        minimum: 1,
        description: "每页条数；缺省按资源类型默认（commands 25 / tools 15 / 其余 30）",
      },
      filter: {
        type: "string",
        description: "子串筛选（大小写不敏感）；字段因资源而异，见各 operation description",
      },
    },
  },
  IntrospectionPageData: {
    type: "object",
    required: ["items", "page", "pageSize", "total", "totalPages"],
    properties: {
      items: { type: "array", items: {} },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 0 },
      total: { type: "integer", minimum: 0, description: "筛选后总条数" },
      totalPages: { type: "integer", minimum: 0, description: "总页数" },
      filter: { type: "string", description: "本次请求的 filter 参数（若有）" },
      note: { type: "string", description: "附加说明（如 MCP 尚未初始化）" },
    },
  },
  IntrospectionCommandItem: {
    type: "object",
    required: ["pattern", "desc"],
    properties: {
      pattern: { type: "string", description: "命令 pattern（segment-matcher）" },
      desc: { type: "string", description: "命令简短说明" },
      plugin: { type: "string", description: "注册该命令的插件名" },
    },
  },
  IntrospectionBotItem: {
    type: "object",
    required: ["adapter", "name", "online"],
    properties: {
      adapter: { type: "string", description: "适配器名" },
      name: { type: "string", description: "Bot 实例名（配置 bots[].name）" },
      online: { type: "boolean", description: "是否已连接/在线" },
    },
  },
  IntrospectionBindingItem: {
    type: "object",
    required: ["name", "provider", "model", "mcpServers", "hasAgentFile"],
    properties: {
      name: { type: "string", description: "ai.agents 绑定名" },
      provider: { type: "string", description: "Provider 别名" },
      model: { type: "string", description: "默认模型 id" },
      mcpServers: {
        type: "array",
        items: { type: "string" },
        description: "绑定的 MCP Server 名列表",
      },
      hasAgentFile: {
        type: "boolean",
        description: "是否存在对应的 *.agent.md 预设文件",
      },
    },
  },
  IntrospectionToolItem: {
    type: "object",
    required: ["name", "description"],
    properties: {
      name: { type: "string", description: "工具名" },
      source: { type: "string", description: "来源标识（builtin / plugin / mcp 等）" },
      description: { type: "string", description: "工具描述" },
    },
  },
  IntrospectionMcpItem: {
    type: "object",
    required: ["name", "connected", "toolCount"],
    properties: {
      name: { type: "string", description: "MCP Server 配置名" },
      connected: { type: "boolean", description: "当前是否已连接" },
      toolCount: { type: "integer", minimum: 0, description: "已注册工具数量" },
    },
  },
};

const PAGINATION_QUERY_PARAMS: RouteMeta["parameters"] = [
  {
    name: "page",
    in: "query",
    required: false,
    description: "页码（从 1 开始，默认 1）",
    schema: { type: "integer", minimum: 1, default: 1 },
  },
  {
    name: "pageSize",
    in: "query",
    required: false,
    description: "每页条数；缺省见各接口默认 pageSize",
    schema: { type: "integer", minimum: 1 },
  },
  {
    name: "filter",
    in: "query",
    required: false,
    description: "子串筛选（大小写不敏感）",
    schema: { type: "string" },
  },
];

function pagedResponseRef(
  itemSchema: string,
  description: string,
): Record<string, unknown> {
  return {
    "200": {
      description,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["success", "data"],
            properties: {
              success: { type: "boolean", enum: [true] },
              data: {
                allOf: [
                  { $ref: "#/components/schemas/IntrospectionPageData" },
                  {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: `#/components/schemas/${itemSchema}` },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    "503": {
      description: "依赖未就绪（如 CommandFeature / AI / ToolFeature 不可用）",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["success", "data", "error"],
            properties: {
              success: { type: "boolean", enum: [false] },
              error: { type: "string" },
              data: {
                type: "object",
                properties: {
                  items: { type: "array", items: {}, maxItems: 0 },
                  page: { type: "integer" },
                  pageSize: { type: "integer" },
                  total: { type: "integer" },
                  totalPages: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function introspectionRouteMeta(
  kind: "commands" | "bots" | "bindings" | "tools" | "mcp",
): RouteMeta {
  const common = {
    tags: ["introspection"],
    parameters: PAGINATION_QUERY_PARAMS,
  };

  switch (kind) {
    case "commands":
      return {
        ...common,
        operationId: "getIntrospectionCommands",
        summary: "分页列出已注册 IM 命令",
        description:
          "与 IM `/cmd [filter] [page]` 同源。filter 匹配：pattern、desc、plugin。默认 pageSize=25。",
        responses: pagedResponseRef(
          "IntrospectionCommandItem",
          "命令列表（分页）",
        ),
      };
    case "bots":
      return {
        ...common,
        operationId: "getIntrospectionBots",
        summary: "分页列出 Bot 实例及在线状态",
        description:
          "与 IM `/bots [filter] [page]` 同源。filter 匹配：adapter、bot name。默认 pageSize=30。",
        responses: pagedResponseRef("IntrospectionBotItem", "Bot 列表（分页）"),
      };
    case "bindings":
      return {
        ...common,
        operationId: "getIntrospectionBindings",
        summary: "分页列出 ai.agents 绑定",
        description:
          "与 IM `/bindings [filter] [page]` 同源。filter 匹配：agent name、provider、model。默认 pageSize=30。AI 未就绪时 503。",
        responses: pagedResponseRef(
          "IntrospectionBindingItem",
          "Agent 绑定列表（分页）",
        ),
      };
    case "tools":
      return {
        ...common,
        operationId: "getIntrospectionTools",
        summary: "分页列出 ToolFeature 已注册工具",
        description:
          "与 IM `/tools [filter] [page]` 同源。filter 匹配：name、source、description。默认 pageSize=15。",
        responses: pagedResponseRef("IntrospectionToolItem", "工具列表（分页）"),
      };
    case "mcp":
      return {
        ...common,
        operationId: "getIntrospectionMcp",
        summary: "分页列出 MCP Server 及连接状态",
        description:
          "与 IM `/mcp [filter] [page]` 同源。filter 匹配：server name。默认 pageSize=30。data.note 可含 Orchestrator 未就绪说明。",
        responses: pagedResponseRef(
          "IntrospectionMcpItem",
          "MCP Server 列表（分页）",
        ),
      };
  }
}
