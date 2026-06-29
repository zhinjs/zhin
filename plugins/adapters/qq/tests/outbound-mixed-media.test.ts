import {
  buildMixedMediaMessagePayload,
  buildQqImageUploadPayload,
  buildTextImageMixedBodyText,
  shouldSendTextImageMixedMedia,
} from "../src/outbound-mixed-media.js";

describe("outbound-mixed-media", () => {
  it("检测内联 base64 图文混排", () => {
    const content = [
      { type: "text", data: { text: "请扫码" } },
      { type: "image", data: { file: "base64://YQ==" } },
    ];
    expect(shouldSendTextImageMixedMedia(content, "auto")).toBe(true);
  });

  it("公网 URL 图文混排不走 mixed-media", () => {
    const content = [
      { type: "text", data: { text: "说明" } },
      { type: "image", data: { url: "https://example.com/a.png" } },
    ];
    expect(shouldSendTextImageMixedMedia(content, "auto")).toBe(false);
  });

  it("构建 file_data 上传 payload", () => {
    expect(buildQqImageUploadPayload({
      type: "image",
      data: { file: "base64://YQ==" },
    })).toEqual({ file_type: 1, file_data: "YQ==" });
  });

  it("构建 msg_type=7 出站体", () => {
    const payload = buildMixedMediaMessagePayload(
      [
        { type: "reply", data: { id: "msg-1" } },
        { type: "text", data: { text: "请扫码" } },
        { type: "image", data: { file: "base64://YQ==" } },
      ],
      "file-info-token",
    );
    expect(payload.msg_type).toBe(7);
    expect(payload.content).toBe("请扫码");
    expect(payload.media).toEqual({ file_info: "file-info-token" });
    expect(payload.msg_id).toBe("msg-1");
  });

  it("合并 text 与 @", () => {
    expect(buildTextImageMixedBodyText([
      { type: "text", data: { text: "hi " } },
      { type: "at", data: { user_id: "u1" } },
    ])).toBe("hi <@u1>");
  });
});
