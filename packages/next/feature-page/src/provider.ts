import { join, parse } from 'node:path';
import { featureId } from '@zhin.js/next-kernel';
import { defineFeatureProvider, type SourceConvention } from '@zhin.js/next-feature-kit';
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
      if (entry.kind !== 'file' || !isPageFile(entry.name)) continue;
      yield {
        localName: parse(entry.name).name,
        source: join(directory, entry.name),
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

function isPageFile(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.tsx?$/u.test(value);
}

export { pageFeature };
export default pageFeature;
