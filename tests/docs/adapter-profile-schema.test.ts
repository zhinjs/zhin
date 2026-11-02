import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv';

const directory = new URL('../../plugins/adapters/', import.meta.url);
const schemas = readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (!entry.isDirectory()) return [];
  let schema: { $defs?: Record<string, object> };
  try {
    schema = JSON.parse(readFileSync(new URL(`${entry.name}/schema.json`, directory), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const profile = schema.$defs?.selfProfileFallback;
  return profile ? [{ adapter: entry.name, profile }] : [];
});
const ajv = new Ajv({ strict: false });

it('finds official adapter profile schemas', () => {
  expect(schemas.length).toBeGreaterThan(0);
});

it.each(schemas)('$adapter validates profile URL and calendar shape before startup', ({ profile }) => {
  const validate = ajv.compile(profile);
  for (const avatar of ['https://', 'http://', 'http://a b', 'data:image/png;base64,AAAA']) {
    expect(validate({ avatar }), avatar).toBe(false);
  }
  for (const avatar of ['', null, 'https://example.test/avatar.png', 'https://example.test/a?size=2']) {
    expect(validate({ avatar }), String(avatar)).toBe(true);
  }
  for (const birthday of ['2024-13-01', '2024-00-01', '2024-01-32']) {
    expect(validate({ birthday }), birthday).toBe(false);
  }
  expect(validate({ birthday: '2024-02-29' })).toBe(true);
  // Full calendar validity (including leap days) is enforced by configuredSelfProfile.
});
