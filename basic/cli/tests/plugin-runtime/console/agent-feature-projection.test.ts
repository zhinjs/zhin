import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  featureId,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  PromptSectionIndex,
  defineAgentPromptSection,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
import {
  listGenerationPromptSections,
  listGenerationTools,
} from '../../../src/plugin-runtime/console/agent-feature-projection.js';

describe('Agent generation feature projections', () => {
  it('projects Prompt Section governance metadata without prompt content', () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: promptSectionFeatureId,
      localName: 'project-rules',
      source: '/project/prompt-sections/project-rules/index.ts',
      definition: defineAgentPromptSection({
        title: 'Project rules',
        content: 'Keep internal policy private.',
        retention: 'required',
      }),
    });
    const base = {
      generation: 12,
      root,
      tree: new Map(),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map(),
    } as unknown as RuntimeSnapshot;
    const snapshot = {
      ...base,
      projections: new Map([[promptSectionFeatureId, new PromptSectionIndex([slot], base)]]),
    } as unknown as RuntimeSnapshot;

    expect(listGenerationPromptSections(snapshot, '/project')).toEqual([expect.objectContaining({
      name: 'project-rules',
      title: 'Project rules',
      retention: 'required',
      source: './prompt-sections/project-rules/index.ts',
      generation: 12,
      contentChars: 29,
    })]);
    expect(listGenerationPromptSections(snapshot, '/project')[0]).not.toHaveProperty('content');
  });

  it('lists visible tools and keeps the last projection for a duplicate name', () => {
    const snapshot = {
      projections: new Map([
        [featureId('zhin.agent-tool'), {
          list: () => [
            { name: 'search', source: '/project/tools/old.ts', description: 'old' },
            { name: 'hidden', source: '/project/tools/hidden.ts', hidden: true },
          ],
        }],
        [featureId('zhin.extra-tool'), {
          list: () => [{ name: 'search', source: '/project/tools/search.ts', description: 'current' }],
        }],
      ]),
    } as unknown as RuntimeSnapshot;

    expect(listGenerationTools(snapshot, '/project')).toEqual([{
      name: 'search',
      source: './tools/search.ts',
      description: 'current',
    }]);
  });
});
