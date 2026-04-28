/**
 * NapCat HTTP 连接方式
 * 出站：HTTP POST 调用 NapCat API
 * 入站：挂载 webhook 路由接收 NapCat 的 HTTP POST 事件上报
 */
import { NapCatBotBase } from './bot-base.js';
import type { NapCatHttpConfig, ApiResponse } from './types.js';
import type { NapCatAdapter } from './adapter.js';
import type { Router } from '@zhin.js/http';
import * as crypto from 'crypto';

export class NapCatHttpBot extends NapCatBotBase {
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
    this.logger.info(`${this.$id} HTTP mode started (api: ${this.$config.http_url}, post: ${this.$config.post_path})`);
  }

  async $disconnect(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
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
    this.router.post(postPath, async (ctx: any) => {
      const body = ctx.request.body;
      if (!body || typeof body !== 'object') { ctx.status = 400; ctx.body = { error: 'invalid body' }; return; }

      if (this.$config.access_token) {
        const sig = ctx.headers['x-signature'];
        if (sig) {
          const expected = 'sha1=' + crypto.createHmac('sha1', this.$config.access_token).update(JSON.stringify(body)).digest('hex');
          if (sig !== expected) { ctx.status = 403; ctx.body = { error: 'signature mismatch' }; return; }
        }
      }

      ctx.status = 204;
      ctx.body = '';
      try { this.dispatchEvent(body); } catch (e) { this.logger.warn(`${this.$id} HTTP event dispatch error: ${e}`); }
    });
    this.logger.info(`${this.$id} webhook mounted at ${postPath}`);
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
        this.logger.warn(`${this.$id} HTTP heartbeat failed, marking as disconnected`);
      }
    }, interval);
  }
}
