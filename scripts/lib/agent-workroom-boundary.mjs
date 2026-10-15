import { parseImports } from './parse-imports.mjs';
import { isAgentForbiddenWorkroomReference } from './workroom-specifier.mjs';

const AGENT_MANIFEST_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];

/**
 * Agent source reference check: no import/re-export (type-only, dynamic and barrel included)
 * may point at the Workroom package or a Workroom-owned directory.
 * @param {{ file: string, content: string }} input
 * @returns {{ file: string, import: string, reason: string }[]}
 */
export function findAgentWorkroomViolations({ file, content }) {
  const violations = [];
  for (const importPath of parseImports(content, { includeTypeOnly: true })) {
    if (!isAgentForbiddenWorkroomReference(importPath)) continue;
    violations.push({
      file,
      import: importPath,
      reason: 'packages/im/agent must not reference @zhin.js/workroom or workroom/portfolio/data-governance/workroom-runtime directories',
    });
  }
  return violations;
}

/**
 * Agent manifest check: `@zhin.js/workroom` must not appear in any dependency section.
 * @param {Record<string, any>} manifest
 * @param {string} manifestPath
 * @returns {{ file: string, import: string, reason: string }[]}
 */
export function findAgentManifestWorkroomViolations(manifest, manifestPath) {
  const violations = [];
  for (const section of AGENT_MANIFEST_SECTIONS) {
    if (Object.hasOwn(manifest[section] ?? {}, '@zhin.js/workroom')) {
      violations.push({
        file: manifestPath,
        import: '@zhin.js/workroom',
        reason: `@zhin.js/agent must not depend on @zhin.js/workroom (${section}); direction is workroom -> agent`,
      });
    }
  }
  return violations;
}
