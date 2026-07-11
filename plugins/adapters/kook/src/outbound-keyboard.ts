/**
 * core keyboard 段 → KOOK 卡片消息（action-group + button）
 */
import { KeyboardSegment, isKeyboardSegment, type KeyboardSegmentData, type MessageElement } from 'zhin.js';

function asKeyboardElement(
  el: MessageElement,
): (MessageElement & { data: KeyboardSegmentData }) | null {
  if (el instanceof KeyboardSegment) {
    return { type: "keyboard", data: el.data };
  }
  if (isKeyboardSegment(el)) return el;
  return null;
}

function textFromElements(elements: MessageElement[]): string {
  return elements
    .filter((el) => el.type === "text" && typeof el.data.text === "string")
    .map((el) => el.data.text as string)
    .join("\n")
    .trim();
}

/** core keyboard 布局 → KOOK card[]（可直接传给 sendChannelMsg / sendPrivateMsg） */
export function coreKeyboardToKookCard(
  data: KeyboardSegmentData,
  prefixElements: MessageElement[] = [],
): Array<Record<string, unknown>> {
  const modules: Array<Record<string, unknown>> = [];
  const prefixText = textFromElements(prefixElements);
  if (prefixText) {
    modules.push({
      type: "section",
      text: { type: "plain-text", content: prefixText },
    });
  }

  for (const row of data.rows ?? []) {
    modules.push({
      type: "action-group",
      elements: row.map((btn) => ({
        type: "button",
        theme: btn.disabled ? "secondary" : "primary",
        value: btn.payload,
        click: "return-val",
        text: { type: "plain-text", content: btn.label },
      })),
    });
  }

  return [{
    type: "card",
    theme: "secondary",
    size: "sm",
    modules,
  }];
}

export function findKeyboardSegment(
  elements: MessageElement[],
): { keyboard: MessageElement & { data: KeyboardSegmentData }; rest: MessageElement[] } | null {
  let keyboard: (MessageElement & { data: KeyboardSegmentData }) | undefined;
  const rest: MessageElement[] = [];

  for (const el of elements) {
    const kb = asKeyboardElement(el);
    if (kb) {
      if (keyboard) return null;
      keyboard = kb;
      continue;
    }
    rest.push(el);
  }

  if (!keyboard) return null;
  return { keyboard, rest };
}
