import { describe, it, expect, vi } from "vitest";
import {
  formatIcqqNotice,
  formatIcqqRequest,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
  shouldRefreshListsOnMeta,
} from "../src/icqq-side-events.js";
import { formatSideEventName } from "zhin.js";

describe("isIcqqNoticePayload", () => {
  it("识别 OneBot notice", () => {
    expect(
      isIcqqNoticePayload({
        post_type: "notice",
        notice_type: "group_increase",
        group_id: 1,
        user_id: 2,
        time: 100,
      }),
    ).toBe(true);
  });
});

describe("formatIcqqNotice", () => {
  it("映射 group_increase → notice.group.member_increase", () => {
    const n = formatIcqqNotice(
      {
        post_type: "notice",
        notice_type: "group_increase",
        sub_type: "approve",
        group_id: 860669870,
        user_id: 999,
        operator_id: 1,
        time: 1716988800,
      },
      "8596238",
    );
    expect(n.$type).toBe("notice");
    expect(n.$scene_type).toBe("group");
    expect(n.$sub_type).toBe("member_increase");
    expect(formatSideEventName(n)).toBe("notice.group.member_increase");
    expect(n.$adapter).toBe("icqq");
    expect(n.$scene_id).toBe("860669870");
    expect(n.sub_type).toBe("approve");
  });

  it("notify poke → notice.group.poke", () => {
    const n = formatIcqqNotice(
      {
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        group_id: 1,
        user_id: 2,
        time: 1,
      },
      "endpoint",
    );
    expect(formatSideEventName(n)).toBe("notice.group.poke");
  });
});

describe("formatIcqqRequest", () => {
  it("好友请求可 approve/reject", async () => {
    const ipc = {
      request: vi.fn().mockResolvedValue({ ok: true }),
    };
    const req = formatIcqqRequest(
      {
        post_type: "request",
        request_type: "friend",
        flag: "abc",
        user_id: 123,
        comment: "hi",
        time: 100,
      },
      "8596238",
      ipc as any,
    );
    expect(formatSideEventName(req)).toBe("request.friend.add");
    await req.$approve("备注");
    expect(ipc.request).toHaveBeenCalledWith(
      "handle_friend_request",
      expect.objectContaining({ flag: "abc", approve: true, remark: "备注" }),
    );
    await req.$reject("不行");
    expect(ipc.request).toHaveBeenCalledWith(
      "handle_friend_request",
      expect.objectContaining({ approve: false, reason: "不行" }),
    );
  });

  it("群邀请请求", () => {
    const req = formatIcqqRequest(
      {
        post_type: "request",
        request_type: "group",
        sub_type: "invite",
        group_id: 99,
        user_id: 1,
        flag: "f1",
        time: 1,
      },
      "endpoint",
      { request: vi.fn() } as any,
    );
    expect(formatSideEventName(req)).toBe("request.group.invite");
    expect(req.$scene_type).toBe("group");
  });
});

describe("shouldRefreshListsOnMeta", () => {
  it("lifecycle connect 时刷新列表", () => {
    expect(
      shouldRefreshListsOnMeta({
        post_type: "meta_event",
        meta_event_type: "lifecycle",
        sub_type: "connect",
      }),
    ).toBe(true);
  });
});

describe("isIcqqRequestPayload", () => {
  it("识别 request", () => {
    expect(
      isIcqqRequestPayload({
        post_type: "request",
        request_type: "friend",
        user_id: 1,
      }),
    ).toBe(true);
  });
});
