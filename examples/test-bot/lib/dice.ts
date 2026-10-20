export function rollDice(count: number, faces: number): string {
  const n = Math.trunc(count);
  const f = Math.trunc(faces);
  if (!Number.isFinite(n) || !Number.isFinite(f) || n < 1 || n > 20) {
    throw new Error('count must be an integer from 1 to 20');
  }
  if (f < 2 || f > 1000) {
    throw new Error('faces must be an integer from 2 to 1000');
  }
  const results: number[] = [];
  for (let i = 0; i < n; i += 1) {
    results.push(1 + Math.floor(Math.random() * f));
  }
  const total = results.reduce((sum, value) => sum + value, 0);
  return `${n}d${f}: [${results.join(', ')}] = ${total}`;
}
