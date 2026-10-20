import { renderImage } from '../../packages/toolkit/components/tests/render-image.js';

/** Exercise real PNG decoding and geometry through an isolated Shotium process. */
export async function assertCardImage(html: string, width = 540) {
  return renderImage(html, width);
}
