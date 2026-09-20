import { join, sep } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, type SourceConvention } from '@zhin.js/feature-kit';
import { parseLayoutArtifact } from './definition.js';
import { LayoutIndex } from './layout-index.js';

export const layoutFeatureId = featureId('zhin.layout');

const layoutFiles: SourceConvention = {
  id: 'layout-client-modules',
  async *discover(context) {
    const directory = join(context.packageRoot, 'pages');
    const entries = [...await context.host.list(directory)]
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const slot = layoutSlot(entry.name);
      if (entry.kind !== 'directory' || !slot) continue;
      const moduleDirectory = join(directory, entry.name);
      const moduleEntries = await context.host.list(moduleDirectory);
      const index = preferredLayoutIndex(
        moduleEntries,
        context.packageRoot.split(sep).includes('node_modules'),
      );
      if (!index) continue;
      yield {
        localName: slot,
        source: join(moduleDirectory, index),
        relatedSources: moduleEntries
          .filter((candidate) => candidate.kind === 'file' && candidate.name !== index)
          .map((candidate) => join(moduleDirectory, candidate.name)),
        target: 'client',
      };
    }
  },
  load(source, context) {
    if (!context.host.loadClientModule) throw new Error('Layout discovery requires a Client Module adapter');
    return context.host.loadClientModule(source.source, {
      feature: layoutFeatureId,
      owner: context.owner,
      localName: source.localName,
    });
  },
};

const layoutFeature = defineFeatureProvider({
  protocol: 1,
  id: layoutFeatureId,
  authoring: { conventions: [layoutFiles], validate: parseLayoutArtifact },
  runtime: {
    project(slots, context) {
      return { value: new LayoutIndex(slots, context.snapshot) };
    },
  },
});

function layoutSlot(directory: string): 'nav' | 'footer' | undefined {
  return directory === 'nav' || directory === 'footer' ? directory : undefined;
}

function preferredLayoutIndex(
  entries: readonly { readonly name: string; readonly kind: 'file' | 'directory' }[],
  preferJavaScript: boolean,
): string | undefined {
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name));
  const extensions = preferJavaScript
    ? ['js', 'mjs', 'cjs', 'ts', 'tsx']
    : ['tsx', 'ts', 'js', 'mjs', 'cjs'];
  return extensions.map((extension) => `index.${extension}`).find((name) => files.has(name));
}

export { layoutFeature };
export default layoutFeature;
