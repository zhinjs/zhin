/**
 * Generated projects execute TypeScript through Plugin Runtime, and @zhin.js/ai depends on
 * undici 8, whose engines require Node >=22.19.0.
 */
export const CREATE_NODE_REQUIREMENT = '>=22.19.0';

export function assertCreateNodeVersion(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 19)) {
    throw new Error(`create-zhin-app requires Node.js ${CREATE_NODE_REQUIREMENT}; current: ${version}. Upgrade Node.js before creating a project.`);
  }
}
