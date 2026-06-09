import { AsyncLocalStorage } from "node:async_hooks";

export type PassiveReplyCapture = {
    /** 同一次 webhook 内最后一次文本出站（被动回复仅支持一条） */
    text: string | null;
};

const passiveReplyStorage = new AsyncLocalStorage<PassiveReplyCapture>();

export function getPassiveReplyCapture(): PassiveReplyCapture | undefined {
    return passiveReplyStorage.getStore();
}

export async function runWithPassiveReplyCapture<T>(
    fn: () => Promise<T>,
): Promise<T> {
    const capture: PassiveReplyCapture = { text: null };
    return passiveReplyStorage.run(capture, fn);
}

export function recordPassiveReplyText(text: string): void {
    const capture = passiveReplyStorage.getStore();
    if (!capture || !text.trim()) return;
    capture.text = text;
}
