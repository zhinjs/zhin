import { dirname, join } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import {
  defineFeatureProvider,
  type SourceConvention,
} from '@zhin.js/feature-kit';
import { parseSkillMarkdown } from './definition.js';
import { SkillIndex } from './skill-index.js';

export const skillFeatureId = featureId('zhin.skill');

const skillFiles: SourceConvention = {
  id: 'skill-markdown',
  async *discover(context) {
    const root = join(context.packageRoot, 'skills');
    const entries = [...await context.host.list(root)]
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.kind !== 'directory' || !isName(entry.name)) continue;
      const directory = join(root, entry.name);
      const children = await context.host.list(directory);
      if (!children.some((child) => child.kind === 'file' && child.name === 'SKILL.md')) continue;
      yield {
        localName: entry.name,
        source: join(directory, 'SKILL.md'),
        target: 'server',
      };
    }
    const agents = [...await context.host.list(join(context.packageRoot, 'agents'))]
      .filter((entry) => entry.kind === 'directory' && isName(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const agent of agents) {
      const skillsRoot = join(context.packageRoot, 'agents', agent.name, 'skills');
      const skills = [...await context.host.list(skillsRoot)]
        .filter((entry) => entry.kind === 'directory' && isName(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const skill of skills) {
        const directory = join(skillsRoot, skill.name);
        const children = await context.host.list(directory);
        if (!children.some((child) => child.kind === 'file' && child.name === 'SKILL.md')) continue;
        yield {
          localName: `agent/${agent.name}/${skill.name}`,
          source: join(directory, 'SKILL.md'),
          relatedSources: Object.freeze(await privateToolSources(context, directory)),
          target: 'server',
        };
      }
    }
  },
  async load(source, context) {
    return {
      markdown: await context.host.readText(source.source),
      privateToolNames: privateToolNames(source.localName, await privateToolDirectories(
        context,
        dirname(source.source),
      )),
    };
  },
};

const skillFeature = defineFeatureProvider({
  protocol: 1,
  id: skillFeatureId,
  authoring: {
    setupMethod: 'addSkill',
    conventions: [skillFiles],
    validate: parseSkillMarkdown,
  },
  runtime: {
    project(slots, context) {
      return { value: new SkillIndex(slots, context.snapshot) };
    },
  },
});

function isName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

async function privateToolDirectories(
  context: Parameters<SourceConvention['discover']>[0],
  skillDirectory: string,
): Promise<string[]> {
  return [...await context.host.list(join(skillDirectory, 'tools'))]
    .filter((entry) => entry.kind === 'directory' && isName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function privateToolSources(
  context: Parameters<SourceConvention['discover']>[0],
  skillDirectory: string,
): Promise<string[]> {
  const result: string[] = [];
  for (const tool of await privateToolDirectories(context, skillDirectory)) {
    for (const entry of await context.host.list(join(skillDirectory, 'tools', tool))) {
      if (entry.kind === 'file') result.push(join(skillDirectory, 'tools', tool, entry.name));
    }
  }
  return result;
}

function privateToolNames(skillName: string, tools: readonly string[]): string[] {
  if (skillName.startsWith('agent/')) {
    const [, agent, skill] = skillName.split('/');
    return tools.map((tool) => `agent__${agent}__skill__${skill}__${tool}`);
  }
  return tools.map((tool) => `skill__${skillName}__${tool}`);
}

export { skillFeature };
export default skillFeature;
