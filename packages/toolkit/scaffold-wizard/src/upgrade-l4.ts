import fs from 'fs-extra';
import path from 'node:path';
import type { PackageJsonLike } from './project-deps.js';
import {
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  getRequiredAIDependenciesForConfig,
  isAiEnabledInConfig,
  findMissingPackageDependencies,
  findUnresolvedPackageInstalls,
  packagesNeedingAiStackFix,
} from './project-deps.js';
import { diagnoseOptionalPeers, formatOptionalPeerFixCommand, getOptionalPeerDependencies } from './optional-peers.js';

export interface UpgradeToL4Diagnosis {
  ai: ReturnType<typeof diagnoseAIDependencies>;
  optionalPeers: ReturnType<typeof diagnoseOptionalPeers>;
  missingAiDeps: string[];
  missingOptionalPeers: string[];
  fixCommand: string;
  configSnippets: string[];
}

const L4_CONFIG_SNIPPETS = [
  '# --- L4 可选多模态（取消注释并安装 optional peer）---',
  '# ai:',
  '#   multimodal:',
  '#     audio:',
  '#       strategy: transcribe   # 需 @zhin.js/speech',
  '# speech:',
  '#   stt:',
  '#     provider: ollama',
  '#     model: whisper',
  '#   tts:',
  '#     provider: edge',
  '# htmlRenderer:',
  '#   width: 540',
];

/** minimal-bot → full-bot / L4 升级诊断 */
export function diagnoseUpgradeToL4(
  cwd: string,
  config: Record<string, unknown>,
  pkg?: PackageJsonLike,
): UpgradeToL4Diagnosis {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = pkg ?? (fs.existsSync(packageJsonPath)
    ? fs.readJsonSync(packageJsonPath) as PackageJsonLike
    : {});

  const aiEnabled = isAiEnabledInConfig(config);
  const ai = aiEnabled ? diagnoseAIDependencies(cwd, config, packageJson) : null;
  const optionalPeers = diagnoseOptionalPeers(cwd, config, packageJson);

  const missingAiDeps = ai
    ? [...new Set([...packagesNeedingAiStackFix(ai), ...ai.notInstalled])]
    : [...Object.keys(getRequiredAIDependenciesForConfig({ ai: { enabled: true } }))];

  if (!aiEnabled) {
    const required = getRequiredAIDependenciesForConfig({ ai: { enabled: true } });
    const fromPkg = findMissingPackageDependencies(packageJson, required);
    const declared = Object.keys(required).filter((n) => !fromPkg.includes(n));
    const notInstalled = findUnresolvedPackageInstalls(cwd, declared);
    missingAiDeps.push(...fromPkg, ...notInstalled);
  }

  const missingOptionalPeers: string[] = [];
  for (const peer of [optionalPeers.speech, optionalPeers.htmlRenderer]) {
    if (!peer?.required) continue;
    missingOptionalPeers.push(
      ...peer.missingFromPackageJson,
      ...peer.notInstalled.filter((n) => !peer.missingFromPackageJson.includes(n)),
    );
  }

  const fixParts: string[] = [];
  if (!aiEnabled || missingAiDeps.length > 0) {
    const required = ai?.required ?? getRequiredAIDependenciesForConfig({ ai: { enabled: true } });
    fixParts.push(formatAIDependencyFixCommand(
      [...new Set(missingAiDeps)],
      required,
    ));
  }
  for (const peer of [optionalPeers.speech, optionalPeers.htmlRenderer]) {
    if (peer && (peer.missingFromPackageJson.length > 0 || peer.notInstalled.length > 0)) {
      fixParts.push(formatOptionalPeerFixCommand(peer));
    }
  }

  return {
    ai,
    optionalPeers,
    missingAiDeps: [...new Set(missingAiDeps)],
    missingOptionalPeers: [...new Set(missingOptionalPeers)],
    fixCommand: fixParts.join(' && '),
    configSnippets: L4_CONFIG_SNIPPETS,
  };
}

export function getUpgradeToL4Dependencies(config: Record<string, unknown>): Record<string, string> {
  const deps = getRequiredAIDependenciesForConfig({ ai: { enabled: true } });
  return { ...deps, ...getOptionalPeerDependencies(config) };
}
