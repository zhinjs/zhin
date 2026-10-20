import type { ActorRef } from './identity.js';

/** Canonical IM segment and media contracts. Platform-only fields belong in `platform`. */
export interface SegmentBase {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly platform?: Readonly<Record<string, unknown>>;
}

export interface MediaRef {
  readonly kind: 'url' | 'path' | 'base64' | 'file';
  readonly value: string;
  readonly mime_type?: string;
  readonly file_name?: string;
  readonly size?: number;
}

export interface TextSegment extends SegmentBase {
  readonly type: 'text';
  readonly data: Readonly<{ text: string }>;
}

export interface MentionSegment extends SegmentBase {
  readonly type: 'mention';
  readonly data: Readonly<{ target: string; name?: string }>;
}

export interface MediaSegment extends SegmentBase {
  readonly type: 'image' | 'audio' | 'video' | 'file';
  readonly data: Readonly<{
    media: MediaRef;
    alt?: string;
    duration?: number;
    name?: string;
  }>;
}

export interface ReplySegment extends SegmentBase {
  readonly type: 'reply';
  readonly data: Readonly<{ message_id: string }>;
}

export interface ForwardEntry {
  readonly actor?: ActorRef;
  readonly timestamp?: number;
  readonly segments: readonly Segment[];
}

export interface ForwardSegment extends SegmentBase {
  readonly type: 'forward';
  readonly data: Readonly<{
    forward_id: string;
    title?: string;
    entries?: readonly ForwardEntry[];
  }>;
}

export interface ShareSegment extends SegmentBase {
  readonly type: 'share';
  readonly data: Readonly<{
    url: string;
    title: string;
    description?: string;
    image?: string;
    audio?: string;
    content?: string;
    artist?: string;
    duration?: number;
    config?: Readonly<{
      appid: number;
      package?: string;
      sign?: string;
      icon?: string;
      version?: string;
    }>;
  }>;
}

export type Segment =
  | TextSegment
  | MentionSegment
  | MediaSegment
  | ReplySegment
  | ForwardSegment
  | ShareSegment
  | SegmentBase;

const mediaKinds = new Set<MediaRef['kind']>(['url', 'path', 'base64', 'file']);

/** Runtime guard for the zero-dependency canonical media contract. */
export function isMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const media = value as Partial<MediaRef>;
  if (typeof media.kind !== 'string' || !mediaKinds.has(media.kind as MediaRef['kind'])) return false;
  if (typeof media.value !== 'string') return false;
  if (media.mime_type !== undefined && typeof media.mime_type !== 'string') return false;
  if (media.file_name !== undefined && typeof media.file_name !== 'string') return false;
  if (media.size !== undefined && typeof media.size !== 'number') return false;
  return true;
}
