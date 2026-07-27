import { join } from 'node:path';
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
    const names = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      const slot = layoutSlot(entry.name);
      if (entry.kind !== 'file' || !slot) continue;
      // 同一 slot 同时存在 .ts 与 .tsx 时以 .tsx 为准，避免重复 slot
      if (entry.name.endsWith('.ts') && names.has(`${entry.name}x`)) continue;
      yield { localName: slot, source: join(directory, entry.name), target: 'client' };
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

function layoutSlot(file: string): 'nav' | 'footer' | undefined {
  if (file === '$nav.tsx' || file === '$nav.ts') return 'nav';
  if (file === '$footer.tsx' || file === '$footer.ts') return 'footer';
  return undefined;
}

export { layoutFeature };
export default layoutFeature;
