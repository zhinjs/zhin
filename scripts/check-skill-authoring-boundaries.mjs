#!/usr/bin/env node
/**
 * Harness: Skill authoring has one shape: skills/<name>/SKILL.md.
 * Packages that publish Skills must ship the directory, depend on @zhin.js/skill,
 * and mount the Feature so the files are reachable at runtime.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoots = ['basic', 'packages', 'plugins', 'examples'];
const ignored = new Set(['node_modules', 'lib', 'dist', '.git']);
const violations = [];
const nativeToolNames = new Set([
  'ask_user', 'bash', 'edit_file', 'generate_image', 'glob', 'grep',
  'knowledge_search', 'list_dir', 'memory_search', 'memory_upsert',
  'read_file', 'todo_read', 'todo_write', 'web_fetch', 'web_search', 'write_file',
]);

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.name === 'skills' && path.basename(directory) === 'agent') {
      violations.push(`${relative(target)}: legacy agent/skills directory; use skills/<name>/SKILL.md`);
    }
    walk(target);
  }
}

function relative(target) {
  return path.relative(repoRoot, target).split(path.sep).join('/');
}

for (const workspaceRoot of workspaceRoots) walk(path.join(repoRoot, workspaceRoot));

for (const workspaceRoot of workspaceRoots) {
  for (const packageJson of packageManifests(path.join(repoRoot, workspaceRoot))) {
    const packageRoot = path.dirname(packageJson);
    const skillsRoot = path.join(packageRoot, 'skills');
    if (!fs.existsSync(skillsRoot)) continue;
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    const skillDirectories = entries.filter((entry) => entry.isDirectory());
    for (const entry of entries) {
      if (entry.isFile() && entry.name === '.gitkeep') continue;
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.name)) {
        violations.push(`${relative(path.join(skillsRoot, entry.name))}: Skill must be a kebab-case directory`);
        continue;
      }
      if (!fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md'))) {
        violations.push(`${relative(path.join(skillsRoot, entry.name))}: missing SKILL.md`);
        continue;
      }
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      const frontmatter = readFrontmatter(fs.readFileSync(skillFile, 'utf8'));
      let metadata;
      try {
        metadata = parseYaml(frontmatter) ?? {};
      } catch (error) {
        violations.push(`${relative(skillFile)}: invalid YAML frontmatter (${error.message})`);
        continue;
      }
      const declaredName = typeof metadata.name === 'string' ? metadata.name : undefined;
      if (declaredName && declaredName !== entry.name) {
        violations.push(`${relative(skillFile)}: name must match directory ${entry.name}`);
      }
      const localTools = new Set(Array.isArray(metadata.tools) ? metadata.tools : []);
      const toolRoot = path.join(packageRoot, 'agent', 'tools');
      const availableTools = new Set(fs.existsSync(toolRoot)
        ? fs.readdirSync(toolRoot, { withFileTypes: true })
          .filter((tool) => tool.isFile() && /^\$.*\.ts$/u.test(tool.name))
          .map((tool) => tool.name.slice(1, -3))
        : []);
      for (const tool of localTools) {
        if (!availableTools.has(tool) && !nativeToolNames.has(tool)) {
          violations.push(`${relative(skillFile)}: tools entry ${tool} has no agent/tools/$${tool}.ts`);
        }
      }
    }
    if (skillDirectories.length === 0) continue;
    const manifest = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    if (manifest.private !== true && !manifest.files?.includes('skills')) {
      violations.push(`${relative(packageJson)}: files must include skills`);
    }
    if (manifest.dependencies?.['@zhin.js/skill'] !== 'workspace:*') {
      violations.push(`${relative(packageJson)}: must depend on @zhin.js/skill`);
    }
    if (!manifest.zhin?.features?.some((feature) => feature.package === '@zhin.js/skill')) {
      violations.push(`${relative(packageJson)}: must mount the @zhin.js/skill Feature`);
    }
  }
}

if (violations.length > 0) {
  console.error('check-skill-authoring-boundaries: FAILED\n');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('check-skill-authoring-boundaries: OK');

function* packageManifests(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const manifest = path.join(target, 'package.json');
    if (fs.existsSync(manifest)) yield manifest;
    else yield* packageManifests(target);
  }
}

function readFrontmatter(markdown) {
  return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown)?.[1] ?? '';
}
