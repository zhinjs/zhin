import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';

const cases = [
  { adapter: 'qq', endpoint: { id: 'one', appid: 'fixture', secret: 'fixture' } },
  { adapter: 'telegram', endpoint: { id: 'one', token: 'fixture' } },
  { adapter: 'slack', endpoint: { id: 'one', token: 'fixture' } },
  { adapter: 'lark', endpoint: { id: 'one', appId: 'fixture', appSecret: 'fixture' } },
  { adapter: 'sandbox', endpoint: { id: 'one' } },
];

it.each(cases)('$adapter validation preserves inherited streaming configuration and explicit overrides', ({ adapter, endpoint }) => {
  const schema = JSON.parse(readFileSync(new URL(`../../plugins/adapters/${adapter}/schema.json`, import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: false, useDefaults: true }).compile(schema);
  const inherited: Record<string, unknown> = { ...endpoint };
  const overridden = { ...endpoint, id: 'two', streaming: true, streamingIntervalMs: 900 };
  const config = { streaming: false, streamingIntervalMs: 1500, endpoints: [inherited, overridden] };
  expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  expect(config.streaming).toBe(false);
  expect(config.streamingIntervalMs).toBe(1500);
  expect(inherited).not.toHaveProperty('streaming');
  expect(inherited).not.toHaveProperty('streamingIntervalMs');
  expect(overridden).toMatchObject({ streaming: true, streamingIntervalMs: 900 });
});
