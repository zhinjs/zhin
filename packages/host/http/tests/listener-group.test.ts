import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  SnapshotStore,
  bindGenerationAdmission,
  createGenerationAdmissionGate,
  featureId,
  generationAdmissionSource,
  rootPluginId,
  type GenerationAdmissionGate,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { createHttpHostGroup, listHttpHostAddresses } from '../src/listener-group.js';
import type { HttpHost, ProcessHttpHost } from '../src/http-host.js';

const hosts: ProcessHttpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('HttpHost listener group', () => {
  it('mirrors one HTTP and WebSocket surface to local HTTP and device HTTPS', async () => {
    const key = readFileSync(new URL('./fixtures/localhost-key.pem', import.meta.url));
    const cert = readFileSync(new URL('./fixtures/localhost-cert.pem', import.meta.url));
    const host = createHttpHostGroup([
      {host: '127.0.0.1', port: 0},
      {host: '127.0.0.1', port: 0, tls: {key, cert}},
    ]);
    hosts.push(host);
    const admission = createGenerationAdmissionGate();
    const store = new SnapshotStore(admissionState(admission));
    const bound = bindGenerationAdmission<HttpHost>(host, admission);
    bound.route('GET', '/probe', (_request, response) => response.end('mirrored'));
    bound.ws('/device', {auth: 'protocol'}).onConnection(({socket}) => socket.send('mirrored'));
    await host.listen();

    const [local, device] = listHttpHostAddresses(host);
    expect(local).toMatchObject({protocol: 'http', secure: false});
    expect(device).toMatchObject({protocol: 'https', secure: true});
    expect(await (await fetch(`${local!.origin}/probe`)).text()).toBe('mirrored');
    await expect(httpsText(device!.port, '/probe', cert)).resolves.toBe('mirrored');
    await expect(webSocketText(`ws://127.0.0.1:${local!.port}/device`)).resolves.toBe('mirrored');
    await expect(webSocketText(`wss://127.0.0.1:${device!.port}/device`, cert)).resolves.toBe('mirrored');
    await store.close();
  });

  it('keeps the primary address compatible and reports every listener in stable order', async () => {
    const host = createHttpHostGroup([
      {host: '127.0.0.1', port: 0},
      {host: '127.0.0.1', port: 0},
    ]);
    hosts.push(host);
    const primary = await host.listen();
    const addresses = listHttpHostAddresses(host);
    expect(host.address).toEqual(primary);
    expect(addresses).toHaveLength(2);
    expect(addresses[0]).toEqual(primary);
    expect(addresses[0]!.port).not.toBe(addresses[1]!.port);
  });
});

function httpsText(port: number, path: string, ca: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      host: '127.0.0.1', port, path, ca, servername: 'localhost', method: 'GET',
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => response.statusCode === 200
        ? resolve(body) : reject(new Error(`HTTPS ${response.statusCode}: ${body}`)));
    });
    request.once('error', reject);
    request.end();
  });
}

function webSocketText(url: string, ca?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ca ? {ca, servername: 'localhost'} : undefined);
    socket.once('message', (value) => { resolve(value.toString()); socket.close(); });
    socket.once('error', reject);
  });
}

function admissionState(gate: GenerationAdmissionGate): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map([[
      featureId('test.http-listener-group-admission'),
      {[generationAdmissionSource]: [gate]},
    ]]),
  };
}
