import { createToken, type Token } from '@zhin.js/plugin-runtime';
import type { VenueProjector } from './projector.js';
import type { VenueRegistry } from './registry.js';

export * from './contracts.js';
export * from './validator.js';
export * from './registry.js';
export * from './membership-port.js';
export * from './router.js';
export * from './floor-controller.js';
export * from './send-limiter.js';
export * from './projector.js';

export const venueRegistryToken: Token<VenueRegistry> = createToken<VenueRegistry>('im.venue-registry');
export const venueProjectorToken: Token<VenueProjector> = createToken<VenueProjector>('im.venue-projector');
