import { join } from 'node:path';
import { featureId } from '@zhin.js/next-kernel';
import {
  defineFeatureProvider,
  type SourceConvention,
} from '@zhin.js/next-feature-kit';
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
  },
  load(source, context) {
    return context.host.readText(source.source);
  },
};

const skillFeature = defineFeatureProvider({
  protocol: 1,
  id: skillFeatureId,
  authoring: {
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

export { skillFeature };
export default skillFeature;
