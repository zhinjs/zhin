import type { Model } from '@zhin.js/ai';
/** Native media support belongs to the selected model, never a whole account. */
export function modelSupportsVision(model: Pick<Model, 'input'>): boolean {
  return model.input.includes('image');
}
