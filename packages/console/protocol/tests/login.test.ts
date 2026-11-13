import { describe, expect, it } from 'vitest';
import {
  CONSOLE_RPC_PERMISSIONS,
  LOGIN_RPC,
  SIDE_EVENT_PUSH,
  consoleRpcPermission,
  resolveConsoleHttpPermission,
  resolveConsoleRpcPermission,
  type ConsoleEventPayloadMap,
  type ConsoleLoginFlow,
  type ConsoleLoginTask,
} from '../src/index.js';

describe('Login Assist v2 protocol (ADR 0058)', () => {
  it('registers every login RPC: reads need endpoint.view, actions endpoint.operate', () => {
    for (const type of Object.values(LOGIN_RPC)) expect(Object.hasOwn(CONSOLE_RPC_PERMISSIONS, type)).toBe(true);
    expect(consoleRpcPermission(LOGIN_RPC.FLOW_LIST)).toBe('endpoint.view');
    expect(consoleRpcPermission(LOGIN_RPC.FLOW_GET)).toBe('endpoint.view');
    expect(consoleRpcPermission(LOGIN_RPC.RELOGIN)).toBe('endpoint.operate');
    expect(consoleRpcPermission(LOGIN_RPC.REFRESH)).toBe('endpoint.operate');
    expect(consoleRpcPermission(LOGIN_RPC.SUBMIT)).toBe('endpoint.operate');
  });

  it('scopes login RPCs that name an Endpoint, and keeps the others global', () => {
    expect(resolveConsoleRpcPermission('login.submit', { type: 'login.submit', data: { taskId: 't', adapter: 'icqq', endpointKey: 'bot1' } }))
      .toMatchObject({ target: { kind: 'endpoint', adapter: 'icqq', endpoint: 'bot1' } });
    expect(resolveConsoleRpcPermission('login.submit', { type: 'login.submit', taskId: 't' }))
      .toMatchObject({ target: { kind: 'global' } });
  });

  it('delivers endpoint.login.flow over the /events stream (status.view)', () => {
    expect(SIDE_EVENT_PUSH.LOGIN_FLOW).toBe('endpoint.login.flow');
    expect(resolveConsoleHttpPermission('GET', '/events')?.permission).toBe('status.view');
  });

  it('types the login events with their real payloads', () => {
    const flow: ConsoleEventPayloadMap['endpoint.login.flow'] = {
      id: 'f', adapter: 'a', endpointKey: 'k', startedAt: 0, updatedAt: 0, revision: 1, attempt: 1, state: 'active', steps: [],
    } satisfies ConsoleLoginFlow;
    const pending: ConsoleEventPayloadMap['endpoint.login.pending'] = {
      id: 't', adapter: 'a', endpointKey: 'k', type: 'qrcode', payload: {}, createdAt: 0,
    } satisfies ConsoleLoginTask;
    expect(flow.state).toBe('active');
    expect(pending.type).toBe('qrcode');
  });
});
