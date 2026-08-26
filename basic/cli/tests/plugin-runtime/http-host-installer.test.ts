import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHttpConfig } from '../../src/plugin-runtime/http-host-installer.js';

const previousToken = process.env.ZHIN_TEST_HTTP_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.ZHIN_TEST_HTTP_TOKEN;
  else process.env.ZHIN_TEST_HTTP_TOKEN = previousToken;
});

describe('Plugin Runtime HTTP Host config', () => {
  it('expands environment references and defaults before creating the Host', async () => {
    process.env.ZHIN_TEST_HTTP_TOKEN = 'secret-from-env';
    await expect(resolveHttpConfig({
      http: {
        token: '${ZHIN_TEST_HTTP_TOKEN}',
        tokens: [{ token: '${MISSING_DEMO_TOKEN:-demo-default}', scope: 'demo', principalId: 'human:alice' }],
        corsOrigins: ['${MISSING_CONSOLE_ORIGIN:-https://console.example.com}'],
      },
    })).resolves.toMatchObject({
      token: 'secret-from-env',
      tokens: [{ token: 'demo-default', scope: 'demo', principalId: 'human:alice' }],
      corsOrigins: ['https://console.example.com'],
    });
  });

  it('loads HTTPS key, certificate and CA files relative to the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-http-tls-'));
    await Promise.all([
      writeFile(join(root, 'server.key'), 'test-key'),
      writeFile(join(root, 'server.crt'), 'test-cert'),
      writeFile(join(root, 'ca.crt'), 'test-ca'),
    ]);
    const result = await resolveHttpConfig({http: {tls: {
      keyFile: 'server.key', certFile: 'server.crt', caFile: 'ca.crt', minVersion: 'TLSv1.3',
    }}}, undefined, root);
    expect(result.tls).toMatchObject({minVersion: 'TLSv1.3'});
    expect(result.tls?.key.toString()).toBe('test-key');
    expect(result.tls?.cert.toString()).toBe('test-cert');
    expect(result.tls?.ca?.toString()).toBe('test-ca');
  });

  it('can ship dormant TLS paths and activate them from the Desktop environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-http-tls-toggle-'));
    await Promise.all([
      writeFile(join(root, 'server.key'), 'generated-key'),
      writeFile(join(root, 'server.crt'), 'generated-cert'),
    ]);
    const config = {http: {tls: {
      enabled: '${ZHIN_DESKTOP_TLS_ENABLED:-false}',
      keyFile: '${ZHIN_DESKTOP_TLS_KEY_FILE}',
      certFile: '${ZHIN_DESKTOP_TLS_CERT_FILE}',
    }}};
    await expect(resolveHttpConfig(config, {}, root)).resolves.toMatchObject({tls: undefined});
    const enabled = await resolveHttpConfig(config, {
      ZHIN_DESKTOP_TLS_ENABLED: 'true',
      ZHIN_DESKTOP_TLS_KEY_FILE: join(root, 'server.key'),
      ZHIN_DESKTOP_TLS_CERT_FILE: join(root, 'server.crt'),
    }, root);
    expect(enabled.tls?.key.toString()).toBe('generated-key');
    expect(enabled.tls?.cert.toString()).toBe('generated-cert');
  });

  it('resolves an environment-gated HTTPS device listener that inherits Host auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-http-device-listener-'));
    await Promise.all([
      writeFile(join(root, 'device.key'), 'device-key'),
      writeFile(join(root, 'device.crt'), 'device-cert'),
    ]);
    const config = {http: {
      host: '127.0.0.1', port: 17888, token: 'desktop-token',
      listeners: [{
        enabled: '${ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED:-false}',
        host: '0.0.0.0', port: 17889,
        tls: {keyFile: '${ZHIN_DESKTOP_TLS_KEY_FILE}', certFile: '${ZHIN_DESKTOP_TLS_CERT_FILE}'},
      }],
    }};
    const dormant = await resolveHttpConfig(config, {}, root);
    expect(dormant.listeners).toBeUndefined();
    const active = await resolveHttpConfig(config, {
      ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED: 'true',
      ZHIN_DESKTOP_WEBVIEW_ORIGIN: 'tauri://localhost',
      ZHIN_DESKTOP_TLS_KEY_FILE: join(root, 'device.key'),
      ZHIN_DESKTOP_TLS_CERT_FILE: join(root, 'device.crt'),
    }, root);
    expect(active).toMatchObject({host: '127.0.0.1', port: 17888, token: 'desktop-token'});
    expect(active.listeners).toHaveLength(1);
    expect(active.listeners?.[0]).toMatchObject({
      host: '0.0.0.0', port: 17889, token: 'desktop-token',
    });
    expect(active.listeners?.[0]?.tls?.key.toString()).toBe('device-key');
    expect(active.listeners?.[0]?.tls?.cert.toString()).toBe('device-cert');
  });

  it('injects the secure Device listener for an upgraded Desktop project with legacy config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-http-legacy-desktop-'));
    await Promise.all([
      writeFile(join(root, 'device.key'), 'legacy-device-key'),
      writeFile(join(root, 'device.crt'), 'legacy-device-cert'),
    ]);
    const result = await resolveHttpConfig({http: {
      host: '127.0.0.1', port: 17888, token: 'persisted-desktop-token',
    }}, {
      ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED: 'true',
      ZHIN_DESKTOP_WEBVIEW_ORIGIN: 'tauri://localhost',
      ZHIN_DESKTOP_TLS_KEY_FILE: join(root, 'device.key'),
      ZHIN_DESKTOP_TLS_CERT_FILE: join(root, 'device.crt'),
    }, root);
    expect(result.listeners).toHaveLength(1);
    expect(result.listeners?.[0]).toMatchObject({
      host: '0.0.0.0', port: 17889, token: 'persisted-desktop-token',
    });
    expect(result.listeners?.[0]?.tls?.key.toString()).toBe('legacy-device-key');
    expect(result.listeners?.[0]?.tls?.cert.toString()).toBe('legacy-device-cert');
    expect(result.corsOrigins).toEqual([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]);
  });

  it('preserves configured CORS entries while allowing every Tauri desktop WebView origin', async () => {
    const result = await resolveHttpConfig({http: {
      corsOrigins: ['https://console.example.test', 'tauri://localhost'],
    }}, {ZHIN_DESKTOP_WEBVIEW_ORIGIN: 'tauri://localhost'});
    expect(result.corsOrigins).toEqual([
      'https://console.example.test',
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]);
  });

  it('rejects an untrusted Desktop WebView origin supplied by the environment', async () => {
    await expect(resolveHttpConfig({http: {}}, {
      ZHIN_DESKTOP_WEBVIEW_ORIGIN: 'https://attacker.example',
    })).rejects.toThrow('not a trusted Tauri origin');
  });

  it('rejects a legacy non-TLS listener that occupies the required Device port', async () => {
    await expect(resolveHttpConfig({http: {listeners: [{
      host: '0.0.0.0', port: 17889,
    }]}}, {
      ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED: 'true',
      ZHIN_DESKTOP_TLS_KEY_FILE: '/unused/device.key',
      ZHIN_DESKTOP_TLS_CERT_FILE: '/unused/device.crt',
    })).rejects.toThrow('conflicts with a non-TLS');
  });

  it('rejects partial and obsolete TLS listener configuration', async () => {
    await expect(resolveHttpConfig({http: {tls: {certFile: 'server.crt'}}}))
      .rejects.toThrow('keyFile and http.tls.certFile are required');
    await expect(resolveHttpConfig({http: {tls: {
      keyFile: 'server.key', certFile: 'server.crt', minVersion: 'TLSv1',
    }}})).rejects.toThrow('minVersion');
    await expect(resolveHttpConfig({http: {tls: {enabled: 'sometimes'}}}))
      .rejects.toThrow('http.tls.enabled must be a boolean');
    await expect(resolveHttpConfig({http: {listeners: {}}}))
      .rejects.toThrow('http.listeners must be an array');
    await expect(resolveHttpConfig({http: {listeners: [{enabled: 'sometimes'}]}}))
      .rejects.toThrow('http.listeners[0].enabled must be a boolean');
  });
});
