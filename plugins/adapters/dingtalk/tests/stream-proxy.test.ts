import tls from 'node:tls';
import net from 'node:net';
import { createDingTalkStreamSocket } from '../src/stream-proxy.js';
import { resolveDingTalkConfig } from '../src/protocol.js';
import { buildAdditionalProfile } from '../../../../examples/platform-acceptance-bot/additional-profiles.mjs';

const constructor = vi.hoisted(() => vi.fn());
vi.mock('ws', () => ({ default: class { constructor(...args: unknown[]) { constructor(...args); } } }));

it('routes only TCP through loopback while preserving real WSS URL and verified TLS identity', () => {
  const socket = new net.Socket();
  const connect = vi.spyOn(tls, 'connect').mockReturnValue(socket as tls.TLSSocket);
  try {
    const url = 'wss://gateway.example.com/path?ticket=private-fixture';
    createDingTalkStreamSocket(url, { port: 18443, serverName: 'gateway.example.com' });
    const [original, options] = constructor.mock.calls.at(-1)!;
    expect(original).toBe(url);
    options.createConnection({ host: 'gateway.example.com', port: 443, path: '/gateway?ticket=fixture', rejectUnauthorized: false });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 18443, path: undefined, servername: 'gateway.example.com', rejectUnauthorized: true }));
  } finally { connect.mockRestore(); socket.destroy(); }
});

it('rejects changed discovery identities and invalid proxy configuration without any bypass connection', () => {
  constructor.mockClear();
  expect(() => createDingTalkStreamSocket('wss://changed.example.com/?ticket=private', { port: 18443, serverName: 'gateway.example.com' })).toThrow('identity changed');
  expect(constructor).not.toHaveBeenCalled();
  for (const streamProxy of [{ port: 0, serverName: 'gateway.example.com' }, { port: 18443, serverName: 'https://gateway.example.com' }]) {
    expect(() => resolveDingTalkConfig({ id: 'test', appKey: 'fixture', appSecret: 'fixture', mode: 'stream', streamProxy })).toThrow('streamProxy');
  }
});

it('maps optional process overrides through the real acceptance profile and requires both fields', () => {
  const environment = { DINGTALK_APP_KEY: 'fixture', DINGTALK_APP_SECRET: 'fixture' };
  expect(buildAdditionalProfile('dingtalk', environment).instance.endpoints[0].streamProxy).toBeUndefined();
  const proxied = buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_STREAM_PROXY_PORT: '18443', DINGTALK_STREAM_PROXY_SERVER_NAME: 'gateway.test' });
  expect(proxied.instance.endpoints[0].streamProxy).toEqual({ port: 18443, serverName: '${DINGTALK_STREAM_PROXY_SERVER_NAME}' });
  expect(() => buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_STREAM_PROXY_PORT: '18443' })).toThrow('DINGTALK_STREAM_PROXY_SERVER_NAME');
  expect(() => buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_STREAM_PROXY_SERVER_NAME: 'gateway.test' })).toThrow('DINGTALK_STREAM_PROXY_PORT');
});
