/**
 * HomeFacade — 别名解析 + 权限 + 意图（tools 薄封装此门面）
 */
import type { Message } from '@zhin.js/core';
import type { HaHomeBackend, HaEntityState, HaServiceResult } from './domains/ha-home-backend.js';
import { parseEntityDomain } from './domains/home-entity.js';
import type { ResolvedHomePolicyConfig } from './home-config.js';
import {
  checkHomeToolAccess,
  toHomeDenyError,
  toHomeOwnerSignal,
} from './home-policy.js';

export type HomeFacadeOk<T> = { ok: true; value: T };
export type HomeFacadeFail = {
  ok: false;
  kind: 'deny' | 'needs_owner' | 'invalid';
  message: string;
};
export type HomeFacadeResult<T> = HomeFacadeOk<T> | HomeFacadeFail;

export interface HomeFacadeOptions {
  backend: HaHomeBackend;
  policy: ResolvedHomePolicyConfig;
}

function fail(kind: HomeFacadeFail['kind'], message: string): HomeFacadeFail {
  return { ok: false, kind, message };
}

function fromAccess(
  decision: ReturnType<typeof checkHomeToolAccess>,
): HomeFacadeFail | null {
  if (decision.allowed) return null;
  if (decision.needsOwnerApproval) {
    return fail('needs_owner', toHomeOwnerSignal(decision));
  }
  return fail('deny', toHomeDenyError(decision));
}

export function mapFacadeFailToToolError(result: HomeFacadeFail): { error: string } {
  return { error: result.message };
}

export class HomeFacade {
  constructor(private readonly options: HomeFacadeOptions) {}

  private authorize(
    operation: 'read' | 'write',
    entityId: string,
    message?: Message,
  ): HomeFacadeFail | null {
    return fromAccess(
      checkHomeToolAccess(operation, entityId, message, this.options.policy),
    );
  }

  private resolve(alias: string): { entityId: string } | HomeFacadeFail {
    try {
      return { entityId: this.options.backend.resolveAlias(alias) };
    } catch (e) {
      return fail('invalid', (e as Error).message);
    }
  }

  async listAliases(message?: Message): Promise<HomeFacadeResult<{ aliases: string[]; count: number } | { aliases: Record<string, never>; message: string }>> {
    const names = Object.keys(this.options.backend.listAliases());
    if (names.length === 0) {
      return { ok: true, value: { aliases: {}, message: '未配置任何设备别名' } };
    }
    // P1: list 也走 requireMaster（用假 entity 过 domain 无关的 master 检查）
    const gate = this.authorize('read', 'light.__list__', message);
    if (gate) return gate;
    return { ok: true, value: { aliases: names, count: names.length } };
  }

  async getState(alias: string, message?: Message): Promise<HomeFacadeResult<HaEntityState & { alias: string }>> {
    const resolved = this.resolve(alias);
    if ('ok' in resolved && resolved.ok === false) return resolved;
    const { entityId } = resolved as { entityId: string };
    const gate = this.authorize('read', entityId, message);
    if (gate) return gate;
    try {
      const state = await this.options.backend.getState(alias);
      return { ok: true, value: { ...state, alias } };
    } catch (e) {
      return fail('invalid', (e as Error).message);
    }
  }

  async turnOn(alias: string, message?: Message): Promise<HomeFacadeResult<HaServiceResult & { message: string }>> {
    return this.writeIntent(alias, message, async () => {
      const result = await this.options.backend.turnOn(alias);
      return { ...result, message: `已执行 ${result.service}` };
    });
  }

  async turnOff(alias: string, message?: Message): Promise<HomeFacadeResult<HaServiceResult & { message: string }>> {
    return this.writeIntent(alias, message, async () => {
      const result = await this.options.backend.turnOff(alias);
      return { ...result, message: `已执行 ${result.service}` };
    });
  }

  async setBrightness(
    alias: string,
    brightness: number,
    message?: Message,
  ): Promise<HomeFacadeResult<{ alias: string; brightness: number; message: string }>> {
    if (isNaN(brightness) || brightness < 0 || brightness > 255) {
      return fail('invalid', 'brightness 须为 0–255');
    }
    return this.writeIntent(alias, message, async () => {
      await this.options.backend.callService(alias, 'turn_on', { brightness });
      return { alias, brightness, message: `已设置亮度 ${brightness}` };
    });
  }

  async setTemperature(
    alias: string,
    temperature: number,
    message?: Message,
  ): Promise<HomeFacadeResult<{ alias: string; temperature: number; message: string }>> {
    if (isNaN(temperature)) return fail('invalid', 'temperature 须为数字');
    return this.writeIntent(alias, message, async () => {
      await this.options.backend.callService(alias, 'set_temperature', { temperature });
      return { alias, temperature, message: `已设置温度 ${temperature}°C` };
    });
  }

  async activateScene(
    alias: string,
    message?: Message,
  ): Promise<HomeFacadeResult<{ alias: string; domain: string; message: string }>> {
    const resolved = this.resolve(alias);
    if ('ok' in resolved && resolved.ok === false) return resolved;
    const { entityId } = resolved as { entityId: string };
    const domain = parseEntityDomain(entityId);
    if (domain !== 'scene' && domain !== 'script') {
      return fail('invalid', `别名 "${alias}" 对应 ${domain}，不是 scene 或 script`);
    }
    return this.writeIntent(alias, message, async () => {
      await this.options.backend.callService(alias, 'turn_on');
      return { alias, domain, message: `已触发 ${domain} "${alias}"` };
    });
  }

  async setCoverPosition(
    alias: string,
    position: number,
    message?: Message,
  ): Promise<HomeFacadeResult<{ alias: string; position: number; message: string }>> {
    if (isNaN(position) || position < 0 || position > 100) {
      return fail('invalid', 'position 须为 0–100');
    }
    return this.writeIntent(alias, message, async () => {
      await this.options.backend.callService(alias, 'set_cover_position', { position });
      return { alias, position, message: `已设置窗帘位置 ${position}%` };
    });
  }

  async callService(
    alias: string,
    service: string,
    data: Record<string, unknown> | undefined,
    message?: Message,
  ): Promise<HomeFacadeResult<{ alias: string; domain: string; service: string; message: string }>> {
    if (!service.trim()) return fail('invalid', 'service 必填');
    const resolved = this.resolve(alias);
    if ('ok' in resolved && resolved.ok === false) return resolved;
    const { entityId } = resolved as { entityId: string };
    const domain = parseEntityDomain(entityId);
    const allowed = this.options.policy.allowedServiceDomains;
    if (!allowed.includes(domain)) {
      return fail('deny', `domain "${domain}" 不在允许的白名单中（允许: ${allowed.join(', ')}）`);
    }
    return this.writeIntent(alias, message, async () => {
      await this.options.backend.callService(alias, service, data);
      return { alias, domain, service, message: `已执行 ${domain}.${service}` };
    });
  }

  private async writeIntent<T>(
    alias: string,
    message: Message | undefined,
    run: () => Promise<T>,
  ): Promise<HomeFacadeResult<T>> {
    const resolved = this.resolve(alias);
    if ('ok' in resolved && resolved.ok === false) return resolved;
    const { entityId } = resolved as { entityId: string };
    const gate = this.authorize('write', entityId, message);
    if (gate) return gate;
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      return fail('invalid', (e as Error).message);
    }
  }
}
