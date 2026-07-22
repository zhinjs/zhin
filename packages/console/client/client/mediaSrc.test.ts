import { describe, expect, it } from 'vitest';
import { pickMediaRawUrl, resolveMediaSrc } from '../client/mediaSrc.js';

describe('pickMediaRawUrl', () => {
  it('prefers canonical media.value / url / file', () => {
    expect(pickMediaRawUrl({ media: { value: 'https://a/b.png' } })).toBe('https://a/b.png');
    expect(pickMediaRawUrl({ url: 'https://a/b.png' })).toBe('https://a/b.png');
    expect(pickMediaRawUrl({ file: '/tmp/a.png' })).toBe('/tmp/a.png');
  });

  it('reads agent outbound image segment (base64 + mime, no url)', () => {
    // media-publisher 出站形态：{ type:'image', data:{ base64, mime, name } }
    const raw = pickMediaRawUrl({ base64: 'aGVsbG8=', mime: 'image/png', name: 'system-status.png' });
    expect(raw).toBe('data:image/png;base64,aGVsbG8=');
    expect(resolveMediaSrc(raw, 'image')).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('falls back to base64:// so resolveMediaSrc applies the kind default MIME', () => {
    const raw = pickMediaRawUrl({ base64: 'aGVsbG8=' });
    expect(raw).toBe('base64://aGVsbG8=');
    expect(resolveMediaSrc(raw, 'image')).toBe('data:image/png;base64,aGVsbG8=');
    expect(resolveMediaSrc(raw, 'audio')).toBe('data:audio/mpeg;base64,aGVsbG8=');
  });

  it('passes through base64 values that already carry a scheme', () => {
    expect(pickMediaRawUrl({ base64: 'base64://aGVsbG8=' })).toBe('base64://aGVsbG8=');
    expect(pickMediaRawUrl({ base64: 'data:image/png;base64,aGVsbG8=' })).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('returns undefined when no media field exists', () => {
    expect(pickMediaRawUrl(undefined)).toBeUndefined();
    expect(pickMediaRawUrl({})).toBeUndefined();
  });
});
