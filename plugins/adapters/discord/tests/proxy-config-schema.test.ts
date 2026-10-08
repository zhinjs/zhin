import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolveDiscordConfig } from '../src/protocol.js';

it('validates environment references before interpolation and validates the resolved proxy strictly at runtime', async () => {
  // Use the real runtime schema engine rather than duplicating its pattern check.
  const require = createRequire(new URL('../../../../packages/im/runtime/package.json', import.meta.url));
  const Ajv2020 = require('ajv/dist/2020.js').default;
  const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const reference = '${DISCORD_GATEWAY_FAULT_PROXY_URL}';
  const validateDirect = new Ajv2020({ strict: false }).compile(schema.properties.gatewayFaultProxyUrl);
  expect(validateDirect(reference)).toBe(true);
  expect(validate({ endpoints: [{ id: 'fixture', token: '${DISCORD_TOKEN}', gatewayFaultProxyUrl: reference }] })).toBe(true);
  expect(resolveDiscordConfig({ id: 'fixture', token: 'fixture', gatewayFaultProxyUrl: 'ws://127.0.0.1:18090/' })).toMatchObject({ gatewayFaultProxyUrl: 'ws://127.0.0.1:18090' });
  // The resolver must not accept an unexpanded reference or an unsafe env value.
  for (const gatewayFaultProxyUrl of [reference, 'ws://evil.example:18090/', 'wss://127.0.0.1:18090/', 'ws://user:secret@127.0.0.1:18090/']) {
    expect(() => resolveDiscordConfig({ id: 'fixture', token: 'fixture', gatewayFaultProxyUrl })).toThrow();
  }
  for (const gatewayFaultProxyUrl of ['${BAD-NAME}', '${}', 'prefix${DISCORD_GATEWAY_FAULT_PROXY_URL}', 'ws://evil.example:18090/']) {
    expect(validateDirect(gatewayFaultProxyUrl)).toBe(false);
    expect(validate({ endpoints: [{ id: 'fixture', token: 'fixture', gatewayFaultProxyUrl }] })).toBe(false);
  }
});
