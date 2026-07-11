/**
 * NapCat HTTP 连接方式
 * 出站：HTTP POST 调用 NapCat API
 * 入站：挂载 webhook 路由接收 NapCat 的 HTTP POST 事件上报
 */
import { formatCompact } from 'zhin.js';
import { NapCatEndpointBase } from './endpoint-base.js';
import type { NapCatHttpConfig, ApiResponse } from './types.js';
import type { NapCatAdapter } from './adapter.js';
import { registerFetchRoute, type Router, type RouterContext } from '@zhin.js/host-router/router';
import * as crypto from 'crypto';

export class NapCatHttpEndpoint extends NapCatEndpointBase {
  private pollTimer?: NodeJS.Timeout;

  declare $config: NapCatHttpConfig;

  constructor(adapter: NapCatAdapter, public router: Router, config: NapCatHttpConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.mountWebhook();
    await this.checkConnection();
    this.startPoll();
    this.$connected = true;
    this.logger.debug(formatCompact({ endpoint: this.$id, mode: 'http' }));
  }

  async $disconnect(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    this.inboundDeduper.clear();
    this.$connected = false;
  }

  async callApi<T = any>(action: string, params: Record<string, any> = {}): Promise<T> {
    const url = `${this.$config.http_url.replace(/\/$/, '')}/${action}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.$config.access_token) headers['Authorization'] = `Bearer ${this.$config.access_token}`;

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${action}`);
    const json = await resp.json() as ApiResponse<T>;
    if (json.status !== 'ok' && json.retcode !== 0) {
      throw new Error(`API error [${json.retcode}]: ${json.message || json.wording || 'unknown'}`);
    }
    return json.data;
  }

  private mountWebhook(): void {
    const postPath = this.$config.post_path;
    registerFetchRoute(this.router, 'POST', postPath, async (ctx: RouterContext) => {
      const body = ctx.request.body;
      if (!body || typeof body !== 'object') { ctx.status = 400; ctx.body = { error: 'invalid body' }; return; }

      if (this.$config.access_token) {
        const sig = ctx.get('x-signature');
        const authHeader = ctx.get('authorization');
        if (sig) {
          const expected = 'sha1=' + crypto.createHmac('sha1', this.$config.access_token).update(JSON.stringify(body)).digest('hex');
          if (sig !== expected) { ctx.status = 403; ctx.body = { error: 'signature mismatch' }; return; }
        } else if (authHeader) {
          if (authHeader !== `Bearer ${this.$config.access_token}`) { ctx.status = 403; ctx.body = { error: 'auth failed' }; return; }
        }
      }

      ctx.status = 204;
      ctx.body = '';
      try { this.dispatchEvent(body); } catch (e) {
        this.logger.warn(formatCompact( { op: 'recv', endpoint: this.$id, ok: false, error: String(e) }));
      }
    });
    this.logger.debug(formatCompact( { op: 'webhook', endpoint: this.$id, path: postPath }));
  }

  private async checkConnection(): Promise<void> {
    try {
      await this.callApi('get_login_info');
    } catch (e) {
      throw new Error(`${this.$id} cannot connect to NapCat HTTP API at ${this.$config.http_url}: ${e}`);
    }
  }

  private startPoll(): void {
    const interval = this.$config.poll_interval || 30000;
    this.pollTimer = setInterval(async () => {
      try {
        await this.callApi('get_status');
      } catch {
        this.$connected = false;
        this.logger.warn(formatCompact( { op: 'heartbeat', endpoint: this.$id, ok: false }));
      }
    }, interval);
  }
}
