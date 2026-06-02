/**
 * LoginAssist — 登录辅助生产者-消费者
 *
 * 适配器在需要人为辅助登录时（扫码、短信、滑块等）作为生产者投递待办；
 * Web 控制台、命令行等作为消费者拉取待办并提交结果。
 * 待办未消费前会一直保留，刷新页面后仍可继续消费。
 *
 * 事件：
 *   bot.login.pending — 有新待办时触发，payload: PendingLoginTask
 */

import type { Plugin } from '../plugin.js';

// ============================================================================
// 类型
// ============================================================================

export type LoginAssistType = 'qrcode' | 'sms' | 'slider' | 'device' | 'other';

export interface PendingLoginTaskPayload {
  /** 说明文案（如「请扫码登录」） */
  message?: string;
  /** 二维码图片 URL 或 base64（type=qrcode 时） */
  image?: string;
  /** 滑块验证 URL（type=slider 时） */
  url?: string;
  /** 其它扩展字段 */
  [key: string]: unknown;
}

export interface PendingLoginTask {
  id: string;
  adapter: string;
  botId: string;
  type: LoginAssistType;
  payload: PendingLoginTaskPayload;
  createdAt: number;
}

interface PendingEntry {
  task: PendingLoginTask;
  resolve: (value: string | Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

// ============================================================================
// LoginAssist 服务
// ============================================================================

export class LoginAssist {
  private readonly plugin: Plugin;
  private readonly pending = new Map<string, PendingEntry>();
  private idSeq = 0;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * 生产者：等待用户输入后 resolve。会发出 bot.login.pending 事件，未消费前可被 listPending 拉取（刷新后可继续消费）。
   */
  waitForInput(
    adapter: string,
    botId: string,
    type: LoginAssistType,
    payload: PendingLoginTaskPayload = {},
  ): Promise<string | Record<string, unknown>> {
    const id = `login-${Date.now()}-${++this.idSeq}`;
    const task: PendingLoginTask = {
      id,
      adapter,
      botId,
      type,
      payload: { message: payload.message ?? '', ...payload },
      createdAt: Date.now(),
    };
    const promise = new Promise<string | Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { task, resolve, reject });
      this.plugin.emit('bot.login.pending', task);
    });
    return promise;
  }

  /**
   * 消费者：提交结果，对应 waitForInput 的 Promise 会 resolve。
   */
  submit(id: string, value: string | Record<string, unknown>): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(value);
    return true;
  }

  /**
   * 消费者：取消某条待办，对应 Promise 会 reject。
   */
  cancel(id: string, reason = 'cancelled'): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.reject(new Error(reason));
    return true;
  }

  /**
   * 列出未消费的待办（供 Web/CLI 展示，刷新后仍可拉取同一列表）。
   */
  listPending(): PendingLoginTask[] {
    return [...this.pending.values()].map((e) => e.task);
  }

  dispose(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error('LoginAssist disposed'));
    }
    this.pending.clear();
  }
}

// ============================================================================
// 扩展 Plugin.Contexts
// ============================================================================

declare module '../plugin.js' {
  namespace Plugin {
    interface Contexts {
      loginAssist: LoginAssist;
    }
  }
}
