/**
 * HomeAssistantService — 别名解析 + HA REST（M4）
 */
import { getLogger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import { type AssistantHomeConfig, resolveAssistantHomeConfig } from '../home-config.js';
const logger = getLogger('home-assistant');

export type HaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HaEntityState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged?: string;
  lastUpdated?: string;
}

const DOMAIN_SERVICE_MAP: Record<string, { on: string; off: string }> = {
  light: { on: 'turn_on', off: 'turn_off' },
  switch: { on: 'turn_on', off: 'turn_off' },
  fan: { on: 'turn_on', off: 'turn_off' },
  cover: { on: 'open_cover', off: 'close_cover' },
  lock: { on: 'unlock', off: 'lock' },
  climate: { on: 'turn_on', off: 'turn_off' },
  media_player: { on: 'turn_on', off: 'turn_off' },
};

export function parseEntityDomain(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot > 0 ? entityId.slice(0, dot) : entityId;
}

export class HomeAssistantService {
  private cfg: ReturnType<typeof resolveAssistantHomeConfig>;
  private fetchFn: HaFetch;

  constructor(homeConfig: AssistantHomeConfig, fetchFn: HaFetch = globalThis.fetch.bind(globalThis)) {
    this.cfg = resolveAssistantHomeConfig(homeConfig);
    this.fetchFn = fetchFn;
  }

  listAliases(): Record<string, string> {
    return { ...this.cfg.aliases };
  }

  resolveAlias(alias: string): string {
    const key = alias.trim();
    const entity = this.cfg.aliases?.[key];
    if (!entity) {
      throw new Error(`未知设备别名: ${alias}（可用: ${Object.keys(this.cfg.aliases ?? {}).join('、') || '无'}）`);
    }
    return entity;
  }

  private baseUrl(): string {
    const url = this.cfg.restUrl?.replace(/\/$/, '');
    if (!url) throw new Error('assistant.home.restUrl 未配置');
    return url;
  }

  private token(): string {
    if (!this.cfg.restToken) throw new Error('assistant.home.restToken 未配置');
    return this.cfg.restToken;
  }

  private async haRequest(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const res = await this.fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token()}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HA API ${res.status}: ${body.slice(0, 200) || res.statusText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  }

  async getState(alias: string): Promise<HaEntityState> {
    const entityId = this.resolveAlias(alias);
    const raw = await this.haRequest(`/api/states/${encodeURIComponent(entityId)}`) as Record<string, unknown>;
    return {
      entityId,
      state: String(raw.state ?? 'unknown'),
      attributes: (raw.attributes as Record<string, unknown>) ?? {},
      lastChanged: raw.last_changed as string | undefined,
      lastUpdated: raw.last_updated as string | undefined,
    };
  }

  resolveServiceForToggle(entityId: string, on: boolean): { domain: string; service: string } {
    const domain = parseEntityDomain(entityId);
    const mapped = DOMAIN_SERVICE_MAP[domain];
    const service = on ? mapped?.on : mapped?.off;
    if (!service) {
      throw new Error(`不支持的控制类型: ${domain}（entity: ${entityId}）`);
    }
    return { domain, service };
  }

  async callService(
    alias: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const entityId = this.resolveAlias(alias);
    const domain = parseEntityDomain(entityId);
    await this.haRequest(`/api/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, ...data }),
    });
    logger.debug(formatCompact({ op: 'ha_service', alias, entityId, domain, service }));
  }

  async turnOn(alias: string): Promise<{ alias: string; entityId: string; service: string }> {
    const entityId = this.resolveAlias(alias);
    const { domain, service } = this.resolveServiceForToggle(entityId, true);
    await this.callService(alias, service);
    return { alias, entityId, service: `${domain}.${service}` };
  }

  async turnOff(alias: string): Promise<{ alias: string; entityId: string; service: string }> {
    const entityId = this.resolveAlias(alias);
    const { domain, service } = this.resolveServiceForToggle(entityId, false);
    await this.callService(alias, service);
    return { alias, entityId, service: `${domain}.${service}` };
  }
}
