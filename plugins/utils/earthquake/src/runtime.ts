import { createToken } from 'zhin.js';
import type { EarthquakeService } from './service.js';

/** Owner-scoped earthquake service shared by commands, the poller and the Agent tool. */
export const earthquakeServiceToken = createToken<EarthquakeService>(
  'zhin.earthquake.service',
  'Owner-scoped earthquake query and subscription service',
);
