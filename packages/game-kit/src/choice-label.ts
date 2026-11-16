/**
 * 按钮文字归一化（#1250 game-button-label-text-not-accepted）：去掉 emoji、变体选择符与空白并转小写，
 * 「🏳️ 放弃」「放弃」「 放 弃 」都得到同一个键。包内部使用，不从入口导出。
 */
export function normalizeChoiceLabel(label: string): string {
  return label
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u{FE0F}|\u{200D}|\u{20E3}/gu, '')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

/** 仅数字序号的 fallback 映射（渲染到键盘段的就是它，文字键只用于入站解析）。 */
export function buildOrdinalFallbackMap(
  gamePrefix: string,
  sessionId: string,
  choices: readonly { readonly id: string; readonly disabled?: boolean }[],
  startIndex: number,
): Record<string, string> {
  const map: Record<string, string> = {};
  let n = startIndex;
  for (const choice of choices) {
    if (!choice.disabled) {
      map[String(n)] = `${gamePrefix}:${sessionId}:${choice.id}`;
      n++;
    }
  }
  return map;
}

