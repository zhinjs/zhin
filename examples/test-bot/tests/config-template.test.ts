import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateModelRuntimeConfig } from '../../../packages/im/agent/src/config/index.js';
import { readApplicationPluginDeclaration } from '../../../packages/im/runtime/src/application-plugin-declaration.js';
import { HOST_CONFIG_SCHEMA, validatePluginConfigSchema } from '../../../packages/im/runtime/src/config-composer.js';
import { parsePackageJson } from '../../../packages/im/runtime/src/manifest.js';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'));
const template = parse(fs.readFileSync(path.join(botRoot, 'zhin.config.example.yml'), 'utf8')) as Record<string, unknown>;

describe('test-bot zhin.config.example.yml', () => {
  it('is a valid configVersion 2 document whose instances are installed dependencies', () => {
    const declaration = readApplicationPluginDeclaration(template);
    expect(declaration.instances.length).toBeGreaterThan(5);
    expect(declaration.instances[0]).toEqual({ instanceKey: 'sandbox', package: '@zhin.js/adapter-sandbox', enabled: true });
    for (const instance of declaration.instances) expect(manifest.dependencies).toHaveProperty(instance.package);
  });

  it('passes the Host schema and every mounted Plugin schema', () => {
    const host = Object.fromEntries(Object.entries(template)
      .filter(([key]) => Object.hasOwn(HOST_CONFIG_SCHEMA.properties, key)));
    expect(validatePluginConfigSchema(HOST_CONFIG_SCHEMA, host)).toEqual([]);
    expect(validateModelRuntimeConfig(template.ai, 'host:example')).toEqual([]);
    for (const instance of readApplicationPluginDeclaration(template).instances) {
      const schemaFile = path.join(botRoot, 'node_modules', instance.package, 'schema.json');
      const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
      expect(validatePluginConfigSchema(schema, template[instance.instanceKey] ?? {}), instance.instanceKey).toEqual([]);
    }
  });

  it('matches the manifest: no page Feature mount without a pages/ directory', () => {
    const parsed = parsePackageJson(manifest, 'package.json');
    const features = parsed.zhin && 'features' in parsed.zhin ? parsed.zhin.features.map(feature => feature.package) : [];
    for (const [feature, directory] of [['@zhin.js/page', 'pages'], ['@zhin.js/skill', 'skills'], ['@zhin.js/agent-feature', 'agents']] as const) {
      expect(features.includes(feature), feature).toBe(fs.existsSync(path.join(botRoot, directory)));
    }
    expect(fs.existsSync(path.join(botRoot, 'client'))).toBe(false);
  });
});
