import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { buildAdditionalProfile } from '../../../../examples/platform-acceptance-bot/additional-profiles.mjs';

it('keeps Lark API proxy optional in profile and validates only the fixed loopback port in schema', () => {
  const env = { LARK_APP_ID: 'fixture', LARK_APP_SECRET: 'fixture', LARK_TEST_CHAT_ID: 'fixture' };
  const plain = buildAdditionalProfile('lark', env);
  expect(JSON.stringify(plain)).not.toContain('webApiProxy');
  const profile = buildAdditionalProfile('lark', { ...env, LARK_WEB_API_PROXY_PORT: '18094' });
  const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  expect(validate(profile.instance)).toBe(true);
  expect(profile.instance.endpoints[0].webApiProxy).toEqual({ port: 18094 });
  expect(validate({ ...profile.instance, webApiProxy: { port: 18094, host: 'external.invalid' } })).toBe(false);
  expect(validate({ ...profile.instance, webApiProxy: { port: 0 } })).toBe(false);
  expect(() => buildAdditionalProfile('lark', { ...env, LARK_WEB_API_PROXY_PORT: '65536' })).toThrow();
});
