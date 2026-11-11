import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateModelRuntimeConfig } from '../../../packages/im/agent/src/config/index.js';
import { readApplicationPluginDeclaration } from '../../../packages/im/runtime/src/application-plugin-declaration.js';
import { HOST_CONFIG_SCHEMA, validatePluginConfigSchema } from '../../../packages/im/runtime/src/config-composer.js';
import { parsePackageJson } from '../../../packages/im/runtime/src/manifest.js';
import { reviewAIPlan } from '../../../tests/helpers/review-ai-plan.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = parse(read('zhin.config.yml')) as Record<string, unknown>;
const manifest = json(path.join(root, 'package.json'));

describe('deploy/huggingface template', () => {
  it('declares plugin instances in the configVersion 2 format', () => {
    const declaration = readApplicationPluginDeclaration(config);
    expect(declaration.instances).toEqual([
      { instanceKey: 'sandbox', package: '@zhin.js/adapter-sandbox', enabled: true },
    ]);
    expect(manifest.dependencies).toHaveProperty('@zhin.js/adapter-sandbox');
  });

  it('passes the Host schema and the Sandbox adapter schema', () => {
    const host = Object.fromEntries(Object.entries(config)
      .filter(([key]) => Object.hasOwn(HOST_CONFIG_SCHEMA.properties, key)));
    expect(validatePluginConfigSchema(HOST_CONFIG_SCHEMA, host)).toEqual([]);
    const sandboxSchema = json(path.join(repo, 'plugins/adapters/sandbox/schema.json'));
    expect(validatePluginConfigSchema(sandboxSchema, config.sandbox)).toEqual([]);
  });

  it('keeps model definitions out of the startup file and ships a reviewable plan', async () => {
    expect(validateModelRuntimeConfig(config.ai, 'host:example')).toEqual([]);
    const plan = parse(read('ai.plan.yml'));
    const reviewed = await reviewAIPlan(plan);
    const chat = reviewed.graph.profiles[reviewed.graph.purposes.defaults.chat!];
    expect(chat.model).toBe('openrouter/free');
    expect(plan.accounts.openrouter.auth).toEqual({ method: 'api-key', source: 'env://OPENROUTER_API_KEY' });
    // The startup seed does not expand ${VAR}; service options must be literal.
    expect(read('ai.plan.yml')).not.toContain('${');
  });

  it('has a valid Plugin manifest and no floating dependency pins', () => {
    const parsed = parsePackageJson(manifest, 'package.json');
    expect(parsed.zhin).toMatchObject({ protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] });
    const ranges = Object.values({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(ranges).not.toContain('latest');
    expect(ranges).not.toContain('*');
  });

  it('copies every file the runtime reads into the image', () => {
    const docker = read('Dockerfile');
    for (const file of ['zhin.config.yml', 'ai.plan.yml', 'plugin.ts']) expect(docker).toContain(file);
  });
});
