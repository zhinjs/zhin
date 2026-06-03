/** 与 create-zhin-app / 仓库 engines 一致 */
export const NODE_ENGINES_HINT = '^20.19.0 || >=22.12.0';

export function isNodeVersionSupported(version = process.version): boolean {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (major > 22) return true;
  if (major === 22) return minor >= 12;
  if (major === 20) return minor >= 19;
  return false;
}

export function formatNodeRequirementMessage(version = process.version): string {
  return isNodeVersionSupported(version)
    ? `${version} (${NODE_ENGINES_HINT})`
    : `${version}（需要 ${NODE_ENGINES_HINT}）`;
}
