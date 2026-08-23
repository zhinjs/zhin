import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { parseAgentPromptSectionDefinition } from './definition.js';
import { PromptSectionIndex } from './prompt-section-index.js';

export const promptSectionFeatureId = featureId('zhin.agent-prompt-section');

const promptSectionFeature = defineFeatureProvider({
  protocol: 1,
  id: promptSectionFeatureId,
  authoring: {
    setupMethod: 'addPromptSection',
    conventions: [typeScriptModules({
      id: 'agent-prompt-sections-ts',
      directory: 'agent/prompt-sections',
      recursive: true,
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
