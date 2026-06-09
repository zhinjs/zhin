import { describe, it, expect } from "vitest";
import {
    getPassiveReplyCapture,
    recordPassiveReplyText,
    runWithPassiveReplyCapture,
} from "../src/passive-reply.js";

describe("WeChat passive reply capture", () => {
    it("仅在 ALS 作用域内记录文本", async () => {
        expect(getPassiveReplyCapture()).toBeUndefined();
        recordPassiveReplyText("ignored");
        expect(getPassiveReplyCapture()).toBeUndefined();

        await runWithPassiveReplyCapture(async () => {
            recordPassiveReplyText("first");
            recordPassiveReplyText("second");
            expect(getPassiveReplyCapture()?.text).toBe("second");
        });
    });
});
