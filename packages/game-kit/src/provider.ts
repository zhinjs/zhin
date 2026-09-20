import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import { parseGameDefinition, type GameDefinition } from './game-definition.js';
import { GameIndex } from './game-index.js';

export const gameFeatureId = featureId('zhin.game');

const gameFeature = defineFeatureProvider<GameDefinition, GameIndex>({
  protocol: 1,
  id: gameFeatureId,
  authoring: {
    setupMethod: 'addGame',
    conventions: [],
    validate: parseGameDefinition,
  },
  runtime: {
    project(slots) {
      return { value: new GameIndex(slots) };
    },
  },
});

export default gameFeature;
