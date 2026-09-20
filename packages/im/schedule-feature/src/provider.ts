import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { parseScheduleDefinition } from './definition.js';
import { ScheduleIndex } from './schedule-index.js';

export const scheduleFeatureId = featureId('zhin.schedule');

const scheduleFeature = defineFeatureProvider({
  protocol: 1,
  id: scheduleFeatureId,
  authoring: {
    setupMethod: 'addSchedule',
    conventions: [directoryModules({
      id: 'schedules-index',
      layouts: [{ segments: ['schedules', capture('name')], localName: (values) => captured(values, 'name') }],
    })],
    validate: parseScheduleDefinition,
  },
  runtime: {
    project(slots, context) {
      const index = new ScheduleIndex(slots, context.snapshot);
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          activateNext: () => index.start(),
          deactivateNext: () => index.stop(),
        },
      };
    },
  },
});

export default scheduleFeature;
