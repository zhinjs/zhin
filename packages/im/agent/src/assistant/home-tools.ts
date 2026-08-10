/**
 * home_* 工具 — 薄封装 HomeFacade（参数校验 + 结果映射）
 */
import { ZhinTool } from '@zhin.js/core';
import {
  HomeFacade,
  mapFacadeFailToToolError,
  type HomeFacadeResult,
} from './home-facade.js';

export interface HomeToolsOptions {
  facade: HomeFacade;
}

function toToolResult<T extends Record<string, unknown>>(result: HomeFacadeResult<T>): T | { error: string } {
  if (!result.ok) return mapFacadeFailToToolError(result);
  return result.value;
}

export function createHomeTools(options: HomeToolsOptions): ZhinTool[] {
  const { facade } = options;

  const listAliases = new ZhinTool('home_list_aliases')
    .desc('列出已配置的智能家居设备别名（不暴露原始 entity_id 给用户层）')
    .keyword('智能家居', '设备列表', 'home list', '别名')
    .tag('home', 'assistant')
    .execute(async (_args, commMessage) => toToolResult(await facade.listAliases(commMessage)));

  const getState = new ZhinTool('home_get_state')
    .desc('读取智能家居设备状态（使用配置别名，如「客厅灯」）')
    .keyword('设备状态', '灯状态', 'home state', '查询')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名（zhin.config.yml assistant.home.aliases 中配置）' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.getState(alias, commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return {
        alias: result.value.alias,
        state: result.value.state,
        attributes: result.value.attributes,
        lastUpdated: result.value.lastUpdated,
      };
    });

  const turnOn = new ZhinTool('home_turn_on')
    .desc('打开/开启智能家居设备（别名，如「客厅灯」）')
    .keyword('开灯', '打开', 'home on', 'turn on')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.turnOn(alias, commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const turnOff = new ZhinTool('home_turn_off')
    .desc('关闭智能家居设备（别名，如「客厅灯」）')
    .keyword('关灯', '关闭', 'home off', 'turn off')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.turnOff(alias, commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const setBrightness = new ZhinTool('home_set_brightness')
    .desc('设置灯光亮度（0–255，使用配置别名）')
    .keyword('亮度', '调光', 'brightness', 'dim')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .param('brightness', { type: 'number', description: '亮度值 0–255' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.setBrightness(alias, Number(args.brightness), commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const setTemperature = new ZhinTool('home_set_temperature')
    .desc('设置温控目标温度（使用配置别名）')
    .keyword('温度', '空调', 'temperature', 'climate')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .param('temperature', { type: 'number', description: '目标温度（摄氏度）' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.setTemperature(alias, Number(args.temperature), commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const activateScene = new ZhinTool('home_activate_scene')
    .desc('触发 HA 场景或脚本（使用配置别名）')
    .keyword('场景', '情景', 'scene', 'script')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '场景/脚本别名' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.activateScene(alias, commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const setCoverPosition = new ZhinTool('home_set_cover_position')
    .desc('设置窗帘位置（0=关闭 100=全开，使用配置别名）')
    .keyword('窗帘', '遮阳', 'cover', 'curtain', 'position')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .param('position', { type: 'number', description: '位置 0–100（0=完全关闭，100=完全打开）' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      const result = await facade.setCoverPosition(alias, Number(args.position), commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  const callServiceTool = new ZhinTool('home_call_service')
    .desc('通用 HA 服务调用（受 domain 白名单约束，仅接受别名）')
    .keyword('服务', 'service', 'call')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .param('service', { type: 'string', description: 'HA 服务名（如 turn_on, set_temperature）' }, true)
    .param('data', { type: 'object', description: '服务参数（可选）' })
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      const svcName = String(args.service ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      if (!svcName) return { error: 'service 必填' };
      const data = (args.data && typeof args.data === 'object') ? args.data as Record<string, unknown> : undefined;
      const result = await facade.callService(alias, svcName, data, commMessage);
      if (!result.ok) return mapFacadeFailToToolError(result);
      return { success: true, ...result.value };
    });

  return [
    listAliases, getState, turnOn, turnOff,
    setBrightness, setTemperature, activateScene, setCoverPosition,
    callServiceTool,
  ];
}
