import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePluginConfigSchema } from '@zhin.js/runtime';
import { jsonSchemaToConsoleSchema } from '../../src/config/console-schema.js';

const adapters = new URL('../../../../../plugins/adapters/', import.meta.url);

describe('Endpoint profile configuration through real adapter schemas', () => {
  it('accepts fallback values at both levels and rejects misspelled or invalid profile fields', () => {
    const schema = JSON.parse(readFileSync(new URL('icqq/schema.json', adapters), 'utf8'));
    const config = {
      master: '1', nickname: 'Default name', profile: { age: 21, interests: ['music'], signature: '' },
      endpoints: [{ id: '123', nickname: 'Account name', profile: { gender: 'female', bio: 'Account biography' } }],
    };
    expect(validatePluginConfigSchema(schema, config)).toEqual([]);
    for (const profile of [{ age: -1 }, { age: '21' }, { interests: 'music' }, { avatar: 'data:image/png;base64,abc' }, { hobby: 'music' }]) {
      expect(validatePluginConfigSchema(schema, { ...config, profile }).length).toBeGreaterThan(0);
    }
  });

  it('projects reusable profile definitions into usable Console forms for every official adapter', () => {
    const roots = readdirSync(fileURLToPath(adapters), { withFileTypes: true })
      .filter(entry => entry.isDirectory());
    for (const root of roots) {
      let schema;
      try { schema = JSON.parse(readFileSync(new URL(`${root.name}/schema.json`, adapters), 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const projected = jsonSchemaToConsoleSchema(schema);
      expect(projected, root.name).toMatchObject({
        object: {
          nickname: { type: 'union', list: [{ type: 'string' }, { type: 'null' }] },
          profile: { type: 'object', object: { gender: {}, age: {}, birthday: {}, signature: {}, avatar: {}, interests: {}, bio: {} } },
          endpoints: { inner: { object: { nickname: { type: 'union', list: [{ type: 'string' }, { type: 'null' }] }, profile: { type: 'object', object: { bio: {} } } } } },
        },
      });
    }
  });
});
