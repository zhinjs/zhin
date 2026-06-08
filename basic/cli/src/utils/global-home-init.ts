import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { globalZhinHome } from './zhin-home.js';

const require = createRequire(import.meta.url);
const cliPkg = require('../../package.json') as { version: string };
const ZHIN_VERSION = `^${cliPkg.version}`;

const GLOBAL_PACKAGE_JSON = {
  name: 'zhin-global',
  private: true,
  version: '0.0.0',
  description: 'Zhin.js 全局实例（~/.zhin）',
  type: 'module',
  scripts: {
    dev: 'zhin dev',
    start: 'zhin start',
  },
  dependencies: {
    'zhin.js': ZHIN_VERSION,
    '@zhin.js/adapter-sandbox': ZHIN_VERSION,
    '@zhin.js/host-api': ZHIN_VERSION,
    '@zhin.js/host-router': ZHIN_VERSION,
  },
  devDependencies: {
    tsx: '^4.22.4',
  },
  engines: {
    node: '^20.19.0 || >=22.12.0',
  },
};

const GLOBAL_CONFIG_YML = `log_level: 1

bots: []

plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"

plugin_dirs:
  - node_modules

hostApi:
  lazyLoad: true

ai:
  enabled: true
  providers:
    ollama:
      api: ollama-chat
      host: http://127.0.0.1:11434
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
  agent:
    execSecurity: allowlist
    execPreset: readonly
  trigger:
    prefixes:
      - "ai:"
    respondToAt: true
    respondToPrivate: true

http:
  token: \${HTTP_TOKEN:-zhin-global-token}
  port: 8068
`;

const GLOBAL_ENV = `# Web 控制台 / HTTP API（与 zhin.config 中 http.token 一致）
HTTP_TOKEN=zhin-global-token

# 默认：本地 Ollama（需先 ollama serve 并 pull agents.zhin.model）
`;

const BOOTSTRAP_FILES: Record<string, string> = {
  'SOUL.md': `# Soul

我是一个能力出众、行动导向的 AI 助手。
`,
  'TOOLS.md': `# Tools Guide

## 工具使用原则

- 低风险操作：直接调用
- 高风险操作：简要说明理由
`,
  'AGENTS.md': `# Agent Memory

长期记忆文件，用于记录重要信息。
`,
};

export type EnsureGlobalHomeOptions = {
  /** 缺少 node_modules 时执行 npm install */
  install?: boolean;
  homeDir?: string;
};

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

type HomeDirOptions = { homeDir?: string };

function resolveHomeDir(options?: string | HomeDirOptions): string {
  if (typeof options === 'string') return options;
  return options?.homeDir ?? os.homedir();
}

/**
 * 初始化 `~/.zhin` 目录结构；已存在文件不会被覆盖。
 */
export function scaffoldGlobalHome(options?: string | HomeDirOptions): string {
  const homeDir = resolveHomeDir(options);
  const root = globalZhinHome(homeDir);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });

  writeIfMissing(
    path.join(root, 'package.json'),
    `${JSON.stringify(GLOBAL_PACKAGE_JSON, null, 2)}\n`,
  );
  writeIfMissing(path.join(root, 'zhin.config.yml'), GLOBAL_CONFIG_YML);
  writeIfMissing(path.join(root, '.env'), GLOBAL_ENV);

  for (const [name, content] of Object.entries(BOOTSTRAP_FILES)) {
    writeIfMissing(path.join(root, name), content);
  }

  return root;
}

export function installGlobalHomeDeps(root: string): void {
  execFileSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
}

/**
 * 确保全局实例可用；可选自动安装依赖。
 */
export async function ensureGlobalHome(
  options: EnsureGlobalHomeOptions = {},
): Promise<string> {
  const root = scaffoldGlobalHome(options);
  if (options.install && !fs.existsSync(path.join(root, 'node_modules', 'zhin.js'))) {
    installGlobalHomeDeps(root);
  }
  return root;
}
