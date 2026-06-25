import { describe, expect, it } from 'vitest';
import { createHtmlRenderer } from '../src/index.js';

describe('@zhin.js/html-renderer', () => {
  it('createHtmlRenderer renders simple html to png', async () => {
    const renderer = createHtmlRenderer({ defaultWidth: 200 });
    const result = await renderer.render('<div>Hi</div>', { format: 'png' });
    expect(result.format).toBe('png');
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect((result.data as Buffer).length).toBeGreaterThan(100);
  });
});
