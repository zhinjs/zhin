import fs from 'fs-extra';
import path from 'node:path';
import type { PackageJsonLike } from './project-deps.js';
import {
  findMissingPackageDependencies,
  findUnresolvedPackageInstalls,
} from './project-deps.js';

export const SPEECH_PACKAGE = '@zhin.js/speech';
export const HTML_RENDERER_PACKAGE = '@zhin.js/html-renderer';

/** 默认 html/markdown policy 为 image 的 adapter context 名 */
export const ADAPTERS_PREFER_HTML_IMAGE = new Set([
  'kook',
  'qq',
  'weixin-ilink',
  'email',
]);

export interface OptionalPeerDiagnosis {
  packageName: string;
  required: boolean;
  reason: string;
  missingFromPackageJson: string[];
  notInstalled: string[];
}

export interface OptionalPeersDiagnosis {
  speech?: OptionalPeerDiagnosis;
  htmlRenderer?: OptionalPeerDiagnosis;
}

function readSpeechStrategy(config: Record<string, unknown>): string | undefined {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return undefined;
  const multimodal = (ai as Record<string, unknown>).multimodal;
  if (!multimodal || typeof multimodal !== 'object' || Array.isArray(multimodal)) return undefined;
  const audio = (multimodal as Record<string, unknown>).audio;
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) return undefined;
  const strategy = (audio as Record<string, unknown>).strategy;
  return strategy != null ? String(strategy) : undefined;
}

function configUsesHtmlImageAdapter(config: Record<string, unknown>): boolean {
  const plugins = Array.isArray(config.plugins)
    ? config.plugins.filter((p): p is string => typeof p === 'string')
    : [];
  for (const plugin of plugins) {
    for (const ctx of ADAPTERS_PREFER_HTML_IMAGE) {
      if (plugin.includes(`adapter-${ctx}`)) return true;
    }
  }
  const endpoints = Array.isArray(config.endpoints) ? config.endpoints : [];
  for (const ep of endpoints) {
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) continue;
    const context = (ep as Record<string, unknown>).context;
    if (typeof context === 'string' && ADAPTERS_PREFER_HTML_IMAGE.has(context)) {
      return true;
    }
  }
  return false;
}

function diagnosePeer(
  cwd: string,
  pkg: PackageJsonLike,
  packageName: string,
  required: boolean,
  reason: string,
): OptionalPeerDiagnosis | undefined {
  if (!required) return undefined;
  const requiredDeps = {
    [packageName]: 'latest',
  };
  const missingFromPackageJson = findMissingPackageDependencies(pkg, requiredDeps);
  const declared = [packageName].filter((n) => !missingFromPackageJson.includes(n));
  const notInstalled = findUnresolvedPackageInstalls(cwd, declared);
  return {
    packageName,
    required: true,
    reason,
    missingFromPackageJson,
    notInstalled,
  };
}

/** 按 zhin.config 推断 optional peer（speech / html-renderer）是否应安装 */
export function diagnoseOptionalPeers(
  cwd: string,
  config: Record<string, unknown>,
  pkg?: PackageJsonLike,
): OptionalPeersDiagnosis {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = pkg ?? (fs.existsSync(packageJsonPath)
    ? fs.readJsonSync(packageJsonPath) as PackageJsonLike
    : {});

  const speechRequired =
    config.speech != null && typeof config.speech === 'object'
    || readSpeechStrategy(config) === 'transcribe';

  const htmlRendererRequired =
    config.htmlRenderer != null && typeof config.htmlRenderer === 'object'
    || configUsesHtmlImageAdapter(config);

  const speech = diagnosePeer(
    cwd,
    packageJson,
    SPEECH_PACKAGE,
    speechRequired,
    speechRequired
      ? (readSpeechStrategy(config) === 'transcribe'
        ? 'ai.multimodal.audio.strategy 为 transcribe'
        : '已配置 speech:')
      : '',
  );

  const htmlRenderer = diagnosePeer(
    cwd,
    packageJson,
    HTML_RENDERER_PACKAGE,
    htmlRendererRequired,
    htmlRendererRequired
      ? (config.htmlRenderer != null
        ? '已配置 htmlRenderer:'
        : 'adapter 出站 policy 使用 html/markdown→image')
      : '',
  );

  return { speech, htmlRenderer };
}

export function formatOptionalPeerFixCommand(diagnosis: OptionalPeerDiagnosis): string {
  const missing = [
    ...diagnosis.missingFromPackageJson,
    ...diagnosis.notInstalled.filter((n) => !diagnosis.missingFromPackageJson.includes(n)),
  ];
  const unique = [...new Set(missing)];
  if (unique.length === 0) return 'pnpm install';
  return `pnpm add ${unique.map((n) => `${n}@latest`).join(' ')}`;
}

export function getOptionalPeerDependencies(config: Record<string, unknown>): Record<string, string> {
  const peers = diagnoseOptionalPeers(process.cwd(), config);
  const deps: Record<string, string> = {};
  if (peers.speech?.required) deps[SPEECH_PACKAGE] = 'latest';
  if (peers.htmlRenderer?.required) deps[HTML_RENDERER_PACKAGE] = 'latest';
  return deps;
}
