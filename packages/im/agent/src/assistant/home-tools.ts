/** Canonical home_* Tool definitions. No IM Message compatibility surface. */
import {
  defineAgentTool,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  HomeFacade,
  mapFacadeFailToToolError,
  type HomeFacadeResult,
} from './home-facade.js';

export interface HomeToolsOptions {
  facade: HomeFacade;
}

export interface HomeToolRegistration {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

function toToolResult<T extends Record<string, unknown>>(result: HomeFacadeResult<T>): T | { error: string } {
  if (!result.ok) return mapFacadeFailToToolError(result);
  return result.value;
}

function schema(
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}

function registration(
  name: string,
  description: string,
  inputSchema: Readonly<Record<string, unknown>>,
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => unknown | Promise<unknown>,
): HomeToolRegistration {
  return Object.freeze({
    name,
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description,
      inputSchema,
      execute,
    }),
  });
}

export function createHomeTools(options: HomeToolsOptions): readonly HomeToolRegistration[] {
  const { facade } = options;
  const aliasProperty = { type: 'string', description: '设备别名' };

  return Object.freeze([
    registration(
      'home_list_aliases',
      '列出已配置的智能家居设备别名（不暴露原始 entity_id 给用户层）',
      schema(),
      async (_input, context) => toToolResult(await facade.listAliases(context.principal)),
    ),
    registration(
      'home_get_state',
      '读取智能家居设备状态（使用配置别名，如「客厅灯」）',
      schema({ alias: aliasProperty }, ['alias']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.getState(alias, context.principal);
        if (!result.ok) return mapFacadeFailToToolError(result);
        return {
          alias: result.value.alias,
          state: result.value.state,
          attributes: result.value.attributes,
          lastUpdated: result.value.lastUpdated,
        };
      },
    ),
    registration(
      'home_turn_on',
      '打开/开启智能家居设备（别名，如「客厅灯」）',
      schema({ alias: aliasProperty }, ['alias']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.turnOn(alias, context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_turn_off',
      '关闭智能家居设备（别名，如「客厅灯」）',
      schema({ alias: aliasProperty }, ['alias']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.turnOff(alias, context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_set_brightness',
      '设置灯光亮度（0–255，使用配置别名）',
      schema({ alias: aliasProperty, brightness: { type: 'number', description: '亮度值 0–255' } }, ['alias', 'brightness']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.setBrightness(alias, Number(input.brightness), context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_set_temperature',
      '设置温控目标温度（使用配置别名）',
      schema({ alias: aliasProperty, temperature: { type: 'number', description: '目标温度（摄氏度）' } }, ['alias', 'temperature']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.setTemperature(alias, Number(input.temperature), context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_activate_scene',
      '触发 HA 场景或脚本（使用配置别名）',
      schema({ alias: { type: 'string', description: '场景/脚本别名' } }, ['alias']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.activateScene(alias, context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_set_cover_position',
      '设置窗帘位置（0=关闭 100=全开，使用配置别名）',
      schema({ alias: aliasProperty, position: { type: 'number', description: '位置 0–100' } }, ['alias', 'position']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        const result = await facade.setCoverPosition(alias, Number(input.position), context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
    registration(
      'home_call_service',
      '通用 HA 服务调用（受 domain 白名单约束，仅接受别名）',
      schema({
        alias: aliasProperty,
        service: { type: 'string', description: 'HA 服务名（如 turn_on, set_temperature）' },
        data: { type: 'object', description: '服务参数（可选）' },
      }, ['alias', 'service']),
      async (input, context) => {
        const alias = String(input.alias ?? '').trim();
        const service = String(input.service ?? '').trim();
        if (!alias) return { error: 'alias 必填' };
        if (!service) return { error: 'service 必填' };
        const data = input.data && typeof input.data === 'object'
          ? input.data as Record<string, unknown>
          : undefined;
        const result = await facade.callService(alias, service, data, context.principal);
        return result.ok ? { success: true, ...result.value } : mapFacadeFailToToolError(result);
      },
    ),
  ]);
}
