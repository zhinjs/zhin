import type { MediaRef, Segment } from './types.js';

export function createImageSegment(
  media: MediaRef,
  options?: { alt?: string; platform?: Record<string, unknown> },
): Segment {
  return {
    type: 'image',
    data: {
      media,
      ...(options?.alt ? { alt: options.alt } : {}),
    },
    ...(options?.platform ? { platform: options.platform } : {}),
  };
}
