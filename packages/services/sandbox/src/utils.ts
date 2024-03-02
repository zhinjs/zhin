export const fixLoop = (loop: string) => {
  let [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop) || [];
  if (/\d+/.test(value))
    value = `[${new Array(+value)
      .fill(0)
      .map((_, i) => i)
      .join(',')}]`;
  if (/^\[.+]$/.test(value)) {
    return { name, value: '__loop__', __loop__: JSON.parse(value) };
  }
  return { name, value };
};
