/**
 * 与 create-zhin-app / 仓库 engines 一致。下限来自 @zhin.js/ai 依赖的 undici 8（engines >=22.19.0，
 * Node 20 上会因缺少 webidl.util.markAsUncloneable 崩溃）。
 */
export const NODE_ENGINES_HINT = '>=22.19.0';

export function isNodeVersionSupported(version = process.version): boolean {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (major > 22) return true;
  return major === 22 && minor >= 19;
}

export function formatNodeRequirementMessage(version = process.version): string {
  return isNodeVersionSupported(version)
    ? `${version} (${NODE_ENGINES_HINT})`
    : `${version}（需要 ${NODE_ENGINES_HINT}）`;
}
