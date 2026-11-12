/**
 * 钉钉 DingTalk platform permit helper（ADR 0056 §5）。
 *
 * 平台身份由适配器上报到 `sender.platform`，permit 由内置评估器（`@zhin.js/permission`）判断；
 * 适配器不再导出自有的 permit 解析器或检查函数。
 */

export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}
