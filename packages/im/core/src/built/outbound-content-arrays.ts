/** Independent structural budget; array nesting does not spend component recursion depth. */
export const MAX_OUTBOUND_ARRAY_DEPTH = 512;

/** Flatten untrusted authoring/native arrays without recursion or shared-reference false positives. */
export function flattenOutboundArray(values: readonly unknown[]): unknown[] {
  const output: unknown[] = [];
  const active = new Set<readonly unknown[]>([values]);
  const frames = [{ values, index: 0 }];
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    if (frame.index >= frame.values.length) {
      active.delete(frame.values);
      frames.pop();
      continue;
    }
    const value = frame.values[frame.index++];
    if (!Array.isArray(value)) {
      output.push(value);
      continue;
    }
    if (active.has(value)) throw new TypeError('Cyclic SendContent array');
    if (frames.length >= MAX_OUTBOUND_ARRAY_DEPTH) throw new RangeError('SendContent array depth exceeded 512');
    active.add(value);
    frames.push({ values: value, index: 0 });
  }
  return output;
}
