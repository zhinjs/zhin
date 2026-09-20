import { featureId } from '@zhin.js/plugin-runtime';
import { capture, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { parseAgentPromptSectionDefinition } from './definition.js';
import { PromptSectionIndex } from './prompt-section-index.js';

export const promptSectionFeatureId = featureId('zhin.agent-prompt-section');

const promptSectionFeature = defineFeatureProvider({
  protocol: 1,
  id: promptSectionFeatureId,
  authoring: {
    setupMethod: 'addPromptSection',
    conventions: [directoryModules({
      id: 'prompt-sections-directory-modules',
      layouts: [{
        segments: ['prompt-sections', capture('section')],
        localName: ({ section = '' }) => section,
      }],
    })],
    validate: parseAgentPromptSectionDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new PromptSectionIndex(slots, context.snapshot) };
    },
  },
});

export { promptSectionFeature };
export default promptSectionFeature;
