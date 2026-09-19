import { describe, expect, it } from 'vitest';
import {
  ROOT_CONFIG_FILE_NAMES,
  rootConfigFormat,
  selectRootConfigFile,
} from '../src/root-config-file.js';

describe('Root config file contract', () => {
  it('contains only Runtime-readable YAML and JSON names', () => {
    expect(ROOT_CONFIG_FILE_NAMES).toEqual([
      'config.yml',
      'config.yaml',
      'config.json',
      'zhin.config.yml',
      'zhin.config.yaml',
      'zhin.config.json',
    ]);
    expect(ROOT_CONFIG_FILE_NAMES.every((name) => rootConfigFormat(name) !== undefined)).toBe(true);
    expect(rootConfigFormat('/project/zhin.config.yml')).toBe('yaml');
    expect(rootConfigFormat('/project/settings.yml')).toBeUndefined();
    expect(rootConfigFormat('zhin.config.toml')).toBeUndefined();
    expect(rootConfigFormat('zhin.config.ts')).toBeUndefined();
  });

  it('rejects projects with more than one Root configuration authority', () => {
    expect(selectRootConfigFile([])).toBeUndefined();
    expect(selectRootConfigFile(['/project/zhin.config.yml'])).toBe('/project/zhin.config.yml');
    expect(() => selectRootConfigFile([
      '/project/config.json',
      '/project/zhin.config.yml',
    ])).toThrow(/Multiple Root config files found/);
  });
});
