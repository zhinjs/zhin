// `http.port`: 1–65535 integers or ${VAR} references; never a silent fallback (#1250).
import { describe, expect, it } from 'vitest';
import { resolveHttpConfig } from '../src/host-installer.js';
import { DEFAULT_HTTP_PORT, InvalidHttpPortError, describeInvalidPortValue, parseHttpPort } from '../src/port.js';

describe('http.port', () => {
  it('uses the port from a ${VAR} reference (a digit string after expansion)', async () => {
    expect((await resolveHttpConfig({ http: { port: '${PORT}' } }, { PORT: '9123' })).port).toBe(9123);
    expect((await resolveHttpConfig({ http: { port: 9124 } })).port).toBe(9124);
    expect((await resolveHttpConfig({ http: {} })).port).toBeUndefined();
  });

  it('refuses invalid ports instead of falling back to the default', async () => {
    await expect(resolveHttpConfig({ http: { port: 'abc' } })).rejects.toThrow(InvalidHttpPortError);
    await expect(resolveHttpConfig({ http: { port: 99999 } })).rejects.toThrow('http.port 无效：端口必须在 1–65535 之间，当前值 99999');
    await expect(resolveHttpConfig({ http: { port: '${PORT}' } }, { PORT: 'abc' })).rejects.toThrow('（来自 ${PORT}）');
    await expect(resolveHttpConfig({ http: { port: '${ZHIN_TEST_UNSET_PORT}' } }, {})).rejects.toThrow('环境变量未设置或为空');
    await expect(resolveHttpConfig({ http: { listeners: [{ host: '127.0.0.1', port: 70000 }] } })).rejects.toThrow('http.listeners[0].port 无效');
  });

  it('describes stored values the schema rejects', () => {
    expect(describeInvalidPortValue(8068)).toBeUndefined();
    expect(describeInvalidPortValue('${PORT:-8068}')).toBeUndefined();
    expect(describeInvalidPortValue(undefined)).toBeUndefined();
    expect(describeInvalidPortValue('8068')).toContain('当前值 "8068"');
    expect(describeInvalidPortValue(1.5)).toContain('整数');
    expect(describeInvalidPortValue(0)).toContain('1–65535');
    expect(parseHttpPort(' 80 ', 'http.port')).toBe(80);
  });

  it('listens on the scaffold default 8068 when no port is configured', () => {
    expect(DEFAULT_HTTP_PORT).toBe(8068);
  });
});
