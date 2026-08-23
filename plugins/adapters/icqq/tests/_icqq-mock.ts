import { vi } from 'vitest';
import { LoginAssist } from '@zhin.js/core';
import type { SideEventGateway } from '@zhin.js/core/runtime';

export function createIcqqTestPorts(): {
  readonly sideEvents: SideEventGateway;
  readonly loginAssist: LoginAssist;
} {
  return {
    sideEvents: {
      receiveNotice: vi.fn(async () => undefined),
      receiveRequest: vi.fn(async () => undefined),
      receiveSystem: vi.fn(async () => undefined),
    },
    loginAssist: new LoginAssist(null, { defaultTimeoutMs: 60_000 }),
  };
}

/**
 * Mock @icqqjs/icqq module for testing IcqqEndpoint (which extends Client).
 *
 * Usage:
 *   vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));
 *
 * Then IcqqEndpoint inherits this mock Client — call endpoint.emit()
 * to simulate icqq events, and vi.mocked(endpoint.method) to assert calls.
 */
export class Client {
  static readonly activeClients = new Map<number, Set<Client>>();
  protected login_timer: ReturnType<typeof setTimeout> | null = null;
  private nextLoginGate?: {
    entered: () => void;
    wait: Promise<void>;
  };

  uin: number;
  fl = new Map<number, unknown>();
  gl = new Map<number, unknown>();
  status = 0;
  dir = '';
  config = {};

  readonly _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(uin?: number | Record<string, unknown>, _config?: unknown) {
    this.uin = typeof uin === 'number' ? uin : 0;
  }

  on(event: string, fn: (...args: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: (...args: unknown[]) => void): this {
    if (fn) {
      this._listeners.get(event)?.delete(fn);
    } else {
      this._listeners.delete(event);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    for (const fn of this._listeners.get(event) ?? []) fn(...args);
    const parts = event.split('.');
    while (parts.length > 1) {
      parts.pop();
      const prefix = parts.join('.');
      for (const fn of this._listeners.get(prefix) ?? []) fn(...args);
    }
    return true;
  }

  login = vi.fn(async (_password?: string) => {
    const gate = this.nextLoginGate;
    this.nextLoginGate = undefined;
    if (gate) {
      gate.entered();
      await gate.wait;
    }
    if (!Client.activeClients.has(this.uin)) Client.activeClients.set(this.uin, new Set());
    Client.activeClients.get(this.uin)!.add(this);
    this.emit('system.online');
  });
  logout = vi.fn(async () => {
    // ICQQ logout sends an account-level unregister packet. Model the observed
    // effect during same-account HMR: every TCP session for that UIN is closed.
    Client.activeClients.delete(this.uin);
  });
  terminate = vi.fn(() => {
    const clients = Client.activeClients.get(this.uin);
    clients?.delete(this);
    if (clients?.size === 0) Client.activeClients.delete(this.uin);
  });
  submitSlider = vi.fn(async (_ticket?: string) => {});
  sendSmsCode = vi.fn(async () => {});
  submitSmsCode = vi.fn(async (_code?: string) => {});

  sendPrivateMsg = vi.fn(async () => ({ message_id: 'sent-1' }));
  sendGroupMsg = vi.fn(async () => ({ message_id: 'sent-1' }));
  sendTempMsg = vi.fn(async () => ({ message_id: 'sent-1' }));
  sendGuildMsg = vi.fn(async () => ({ message_id: 'sent-1' }));

  deleteMsg = vi.fn(async () => true);
  getSystemMsg = vi.fn(async (): Promise<unknown[]> => []);
  setFriendAddRequest = vi.fn(async () => true);
  setGroupAddRequest = vi.fn(async () => true);
  deleteFriend = vi.fn(async () => true);
  setGroupKick = vi.fn(async () => true);
  setGroupBan = vi.fn(async () => true);
  setGroupAdmin = vi.fn(async () => true);
  setGroupAnonymous = vi.fn(async () => true);
  setGroupSpecialTitle = vi.fn(async () => true);
  sendLike = vi.fn(async () => true);
  sendGroupPoke = vi.fn(async () => true);
  sendGroupSign = vi.fn(async () => ({ result: 0 }));
  inviteFriend = vi.fn(async () => true);
  sendGroupNotice = vi.fn(async () => true);
  getGuildList = vi.fn((): unknown[] => []);
  getChannelList = vi.fn((): unknown[] => []);
  getForwardMsg = vi.fn(async (): Promise<unknown[]> => []);
  setEssenceMessage = vi.fn(async () => '');
  removeEssenceMessage = vi.fn(async () => '');
  acquireGfs = vi.fn(() => ({ ls: vi.fn(async () => []) }));
  getGroupMemberList = vi.fn(async () => new Map<number, unknown>());
  getFriendList = vi.fn(() => new Map<number, unknown>());
  getGroupList_method = vi.fn(() => new Map<number, unknown>());
  setReaction = vi.fn(async () => ({}));
  delReaction = vi.fn(async () => ({}));
  pickGroup = vi.fn((_gid?: number) => ({
    setReaction: this.setReaction,
    delReaction: this.delReaction,
  }));
}

export function isMockIcqqClientConnected(client: Client): boolean {
  return Client.activeClients.get(client.uin)?.has(client) ?? false;
}

export function scheduleMockIcqqReconnect(client: Client, delayMs: number): void {
  const state = client as unknown as { login_timer: ReturnType<typeof setTimeout> | null };
  state.login_timer = setTimeout(() => {
    state.login_timer = null;
    void client.login();
  }, delayMs);
}

export function hangNextMockIcqqLogin(client: Client): {
  readonly entered: Promise<void>;
  readonly release: () => void;
} {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const state = client as unknown as {
    nextLoginGate?: { entered: () => void; wait: Promise<void> };
  };
  state.nextLoginGate = { entered: markEntered, wait };
  return { entered, release };
}

export function parseGroupMessageId(msgid: string): {
  group_id: number;
  user_id: number;
  seq: number;
  rand: number;
  time: number;
  pktnum: number;
} {
  if (!/^[1-9]\d*$/.test(msgid)) {
    throw new Error(`invalid mock group message id: ${msgid}`);
  }
  return { group_id: 0, user_id: 0, seq: Number(msgid), rand: 0, time: 0, pktnum: 1 };
}
