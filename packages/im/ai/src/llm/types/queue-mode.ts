/** Agent queue drain mode (ADR 0009 D6 / Grill #13). */
export type QueueMode = 'one-at-a-time' | 'all';

export const DEFAULT_STEERING_MODE: QueueMode = 'one-at-a-time';
export const DEFAULT_FOLLOW_UP_MODE: QueueMode = 'one-at-a-time';
