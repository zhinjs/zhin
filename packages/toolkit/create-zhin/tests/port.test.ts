import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseHttpPort, defaultPortProbe, describePortChoice, type PortProbe } from '../src/port.js';
import { createText } from '../src/messages.js';

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function fakeProbe(taken: readonly number[], occupant: 'zhin-gateway' | 'other' = 'zhin-gateway'): PortProbe & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    free: async (port) => { asked.push(port); return !taken.includes(port); },
    occupant: async () => occupant,
  };
}

const text = (key: string, values: readonly unknown[]) => createText('zh-CN', key, values);

describe('chooseHttpPort (#1250 scaffold-port-collision)', () => {
  it('keeps the preferred port when it is free', async () => {
    const choice = await chooseHttpPort(8068, fakeProbe([]));
    expect(choice).toEqual({ port: 8068 });
    expect(describePortChoice(choice, text)).toBeUndefined();
  });

  it('moves to the next free port and names another Zhin gateway as the occupant', async () => {
    const choice = await chooseHttpPort(8068, fakeProbe([8068, 8069]));
    expect(choice).toEqual({ port: 8070, collision: { port: 8068, occupant: 'zhin-gateway' } });
    expect(describePortChoice(choice, text)).toBe('端口 8068 已被另一个 Zhin 网关占用（同一台机器上的其他项目），新项目改用端口 8070（http.port）。');
  });

  it('says when another program holds the port, and keeps it when nothing nearby is free', async () => {
    const other = await chooseHttpPort(8068, fakeProbe([8068], 'other'));
    expect(describePortChoice(other, text)).toContain('已被其他程序占用，新项目改用端口 8069');
    const none = await chooseHttpPort(8068, fakeProbe(Array.from({ length: 30 }, (_, index) => 8068 + index)), 5);
    expect(none.port).toBe(8068);
    expect(describePortChoice(none, text)).toContain('附近也没有空闲端口');
  });

  it('detects a real listener and recognises a Zhin gateway by /pub/health', async () => {
    const gateway = await listen((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(request.url === '/pub/health'
        ? JSON.stringify({ success: true, status: 'ok', instance: { state: 'running', ready: true } })
        : '{}');
    });
    expect(await defaultPortProbe.free(gateway)).toBe(false);
    expect(await defaultPortProbe.occupant(gateway)).toBe('zhin-gateway');

    const plain = await listen((_request, response) => { response.statusCode = 404; response.end(); });
    expect(await defaultPortProbe.occupant(plain)).toBe('other');
  });
});
