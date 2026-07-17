import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface InitProjectOptions {
  readonly packageName: string;
  readonly force?: boolean;
}

export interface CreatePackageOptions {
  readonly name: string;
  readonly packageName?: string;
}

export class ProjectScaffolder {
  constructor(private readonly root: string) {}

  async init(options: InitProjectOptions): Promise<void> {
    assertPackageName(options.packageName);
    const packageFile = join(this.root, 'package.json');
    if (!options.force && await exists(packageFile)) {
      throw new Error(`Project already exists: ${packageFile}`);
    }
    await mkdir(this.root, { recursive: true });
    await writeJson(packageFile, {
      name: options.packageName,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'tsc --noEmit' },
      dependencies: {
        '@zhin.js/next-kernel': '^0.0.0',
        '@zhin.js/next-runtime': '^0.0.0',
      },
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        engine: '^1.0.0',
        runtime: 'trusted',
        features: [],
        plugins: [],
      },
    });
    await writeFile(join(this.root, 'pnpm-workspace.yaml'), [
      'packages:',
      '  - packages/*',
      '  - plugins/*',
      '',
    ].join('\n'));
    await writeJson(join(this.root, 'schema.json'), {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
    await writeFile(join(this.root, 'plugin.ts'), [
      "import { definePlugin } from '@zhin.js/next-kernel';",
      '',
      "export default definePlugin({ name: 'root' });",
      '',
    ].join('\n'));
    await writeJson(join(this.root, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
      },
      include: [
        'plugin.ts',
        'commands/**/*.ts',
        'commands/**/*.tsx',
        'components/**/*.ts',
        'components/**/*.tsx',
        'middlewares/**/*.ts',
        'adapters/**/*.ts',
        'tools/*.ts',
        'mcp/*.ts',
        'plugins/**/*.ts',
        'packages/**/*.ts',
      ],
    });
  }

  async createPlugin(options: CreatePackageOptions): Promise<string> {
    assertLocalName(options.name);
    const rootPackage = await this.#readRootPackage();
    const packageName = options.packageName ?? childPackageName(rootPackage.name, 'plugin', options.name);
    assertPackageName(packageName);
    const packageRoot = join(this.root, 'plugins', options.name);
    await assertMissing(packageRoot);

    await writeJson(join(packageRoot, 'package.json'), {
      name: packageName,
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { '@zhin.js/next-kernel': '^0.0.0' },
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        engine: '^1.0.0',
        runtime: 'trusted',
        features: [],
        plugins: [],
      },
    });
    await writeFile(join(packageRoot, 'plugin.ts'), [
      "import { definePlugin } from '@zhin.js/next-kernel';",
      '',
      `export default definePlugin({ name: '${options.name}' });`,
      '',
    ].join('\n'));
    await writeJson(join(packageRoot, 'schema.json'), {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {},
    });

    rootPackage.dependencies = { ...rootPackage.dependencies, [packageName]: 'workspace:*' };
    rootPackage.zhin.plugins = [
      ...rootPackage.zhin.plugins,
      { package: packageName, instanceKey: options.name },
    ];
    await writeJson(join(this.root, 'package.json'), rootPackage);
    return packageRoot;
  }

  async createFeature(options: CreatePackageOptions): Promise<string> {
    assertLocalName(options.name);
    const rootPackage = await this.#readRootPackage();
    const packageName = options.packageName ?? childPackageName(rootPackage.name, 'feature', options.name);
    assertPackageName(packageName);
    const packageRoot = join(this.root, 'packages', options.name);
    await assertMissing(packageRoot);
    const id = featureName(packageName);

    await writeJson(join(packageRoot, 'package.json'), {
      name: packageName,
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@zhin.js/next-feature-kit': '^0.0.0',
        '@zhin.js/next-kernel': '^0.0.0',
      },
      zhin: {
        protocol: 1,
        type: 'feature',
        entry: './src/provider.ts',
        engine: '^1.0.0',
        featureApi: '1.0.0',
      },
    });
    await mkdir(join(packageRoot, 'src'), { recursive: true });
    await writeFile(join(packageRoot, 'src/provider.ts'), [
      "import { defineFeatureProvider } from '@zhin.js/next-feature-kit';",
      "import { featureId } from '@zhin.js/next-kernel';",
      '',
      'export default defineFeatureProvider({',
      '  protocol: 1,',
      `  id: featureId('${id}'),`,
      '  authoring: {',
      '    conventions: [],',
      '    validate: (value) => value,',
      '  },',
      '  runtime: {',
      '    project: (slots) => ({ value: Object.freeze([...slots]) }),',
      '  },',
      '});',
      '',
    ].join('\n'));

    rootPackage.dependencies = { ...rootPackage.dependencies, [packageName]: 'workspace:*' };
    rootPackage.zhin.features = [
      ...rootPackage.zhin.features,
      { package: packageName, api: '^1.0.0' },
    ];
    await writeJson(join(this.root, 'package.json'), rootPackage);
    return packageRoot;
  }

  async #readRootPackage(): Promise<MutableRootPackage> {
    const file = join(this.root, 'package.json');
    const value = JSON.parse(await readFile(file, 'utf8')) as MutableRootPackage;
    if (value.zhin?.type !== 'plugin') throw new Error(`${file} is not a Zhin Plugin project`);
    value.dependencies ??= {};
    value.zhin.features ??= [];
    value.zhin.plugins ??= [];
    return value;
  }
}

interface MutableRootPackage {
  name: string;
  dependencies?: Record<string, string>;
  zhin: {
    type: string;
    features: Array<{ package: string; api?: string }>;
    plugins: Array<{ package: string; instanceKey: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertMissing(path: string): Promise<void> {
  if (await exists(path)) throw new Error(`Path already exists: ${path}`);
}

function assertLocalName(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new TypeError(`Invalid local name: ${value}`);
}

function assertPackageName(value: string): void {
  if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value)) {
    throw new TypeError(`Invalid package name: ${value}`);
  }
}

function childPackageName(root: string, type: 'plugin' | 'feature', name: string): string {
  const scope = root.startsWith('@') ? root.slice(0, root.indexOf('/')) : undefined;
  return scope ? `${scope}/${type}-${name}` : `${root}-${type}-${name}`;
}

function featureName(packageName: string): string {
  const normalized = packageName
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  if (!normalized) return 'custom.feature';
  return /^[a-z]/.test(normalized) ? normalized : `custom.${normalized}`;
}
