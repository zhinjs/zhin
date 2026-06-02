/** 将历史 `:segment+` splat 转为 path-to-regexp v8 的 `*segment`。 */
export function toKoaRouterPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)\+/g, "*$1");
}
