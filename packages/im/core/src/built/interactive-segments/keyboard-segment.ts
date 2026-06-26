import type { KeyboardSegmentData } from './types.js';
import { KEYBOARD_SEGMENT_TYPE } from './types.js';

export class KeyboardSegment {
  readonly segmentType = KEYBOARD_SEGMENT_TYPE;

  constructor(public readonly data: KeyboardSegmentData) {}

  toElement() {
    return { type: this.segmentType, data: this.data };
  }
}

/** @deprecated 使用 {@link KeyboardSegment} */
export const InteractiveSegment = KeyboardSegment;
