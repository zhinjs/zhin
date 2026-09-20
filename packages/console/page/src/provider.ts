import { join, sep } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import {
  defineFeatureProvider,
  type SourceConvention,
} from '@zhin.js/feature-kit';
import { parsePageArtifact } from './definition.js';
import { PageIndex } from './page-index.js';

export const pageFeatureId = featureId('zhin.page');

const pageFiles: SourceConvention = {
  id: 'pages-client-modules',
  async *discover(context) {
    const directory = join(context.packageRoot, 'pages');
    const entries = [...await context.host.list(directory)]
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.kind !== 'directory' || !isPageName(entry.name)
        || entry.name === 'nav' || entry.name === 'footer') continue;
      const moduleDirectory = join(directory, entry.name);
      const moduleEntries = await context.host.list(moduleDirectory);
      const index = preferredPageIndex(moduleEntries, context.packageRoot.split(sep).includes('node_modules'));
      if (!index) continue;
      yield {
        localName: entry.name,
        source: join(moduleDirectory, index),
        relatedSources: moduleEntries
          .filter((candidate) => candidate.kind === 'file' && candidate.name !== index)
          .map((candidate) => join(moduleDirectory, candidate.name)),
        target: 'client',
      };
    }
  },
  load(source, context) {
    if (!context.host.loadClientModule) throw new Error('Page discovery requires a Client Module adapter');
    return context.host.loadClientModule(source.source, {
      feature: pageFeatureId,
      owner: context.owner,
      localName: source.localName,
    });
  },
};

const pageFeature = defineFeatureProvider({
  protocol: 1,
  id: pageFeatureId,
  authoring: { conventions: [pageFiles], validate: parsePageArtifact },
  runtime: {
    project(slots, context) {
      return { value: new PageIndex(slots, context.snapshot) };
    },
  },
});

function isPageName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function preferredPageIndex(
  entries: readonly { readonly name: string; readonly kind: 'file' | 'directory' }[],
  preferJavaScript: boolean,
): string | undefined {
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name));
  const extensions = preferJavaScript
    ? ['js', 'mjs', 'cjs', 'ts', 'tsx']
    : ['ts', 'tsx', 'js', 'mjs', 'cjs'];
  return extensions.map((extension) => `index.${extension}`).find((name) => files.has(name));
}

export { pageFeature };
export default pageFeature;
