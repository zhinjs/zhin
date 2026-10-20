// Small reporting helpers so every smoke scenario prints which user-visible step it verified.
import assert from 'node:assert/strict';

export const SMOKE_STEP_PREFIX = 'SMOKE_STEP';

/** @param {string} step @param {() => Promise<void> | void} verify */
export async function smokeStep(step, verify) {
  try {
    await verify();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Smoke step failed: ${step}\n${reason}`, { cause: error });
  }
  console.log(`${SMOKE_STEP_PREFIX} ${step}`);
}

/** @param {readonly { payload: unknown }[]} deliveries */
export function lastDeliveryText(deliveries) {
  const delivery = deliveries.at(-1);
  assert.ok(delivery, 'expected at least one delivery');
  return deliveryText(delivery.payload);
}

/** @param {unknown} payload */
export function deliveryText(payload) {
  if (typeof payload === 'string') return payload;
  if (!Array.isArray(payload)) return JSON.stringify(payload);
  const texts = payload.map(segment => segment?.type === 'text' ? String(segment.data?.text ?? '') : `[${segment?.type}]`);
  return texts.join('');
}
