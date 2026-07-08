import { describe, expect, it } from "vitest";
import {
  channelFromStoredRow,
  inboxChannelWhere,
  parentFromStoredRow,
  storedParentFields,
  toConsoleChannel,
  toConsoleChannelParent,
} from "../src/endpoint-channel.js";

describe("endpoint-channel", () => {
  it("normalizes legacy parent.type channel to guild", () => {
    expect(toConsoleChannelParent({ type: "channel", id: "g1" })).toEqual({
      type: "guild",
      id: "g1",
    });
  });

  it("accepts group and guild parent types", () => {
    expect(toConsoleChannelParent({ type: "group", id: "123" })).toEqual({
      type: "group",
      id: "123",
    });
    expect(
      toConsoleChannelParent({
        type: "guild",
        id: "650779094005186335",
        name: "My Guild",
      }),
    ).toEqual({
      type: "guild",
      id: "650779094005186335",
      name: "My Guild",
    });
  });

  it("stored parent fields round-trip", () => {
    const parent = { type: "guild" as const, id: "g1" };
    expect(storedParentFields(parent)).toEqual({
      channel_parent_type: "guild",
      channel_parent_id: "g1",
    });
    expect(
      parentFromStoredRow({
        channel_parent_type: "guild",
        channel_parent_id: "g1",
      }),
    ).toEqual(parent);
  });

  it("inbox where combines channelId with optional parent", () => {
    const base = {
      adapter: "icqq",
      endpoint_id: "8596238",
      channel_id: "634415832",
      channel_type: "channel",
    };
    expect(inboxChannelWhere(base)).toEqual(base);
    expect(
      inboxChannelWhere(base, { type: "guild", id: "650779094005186335" }),
    ).toEqual({
      ...base,
      channel_parent_type: "guild",
      channel_parent_id: "650779094005186335",
    });
  });

  it("channelFromStoredRow restores id, name, parent", () => {
    expect(
      channelFromStoredRow({
        channel_id: "634415832",
        channel_name: "general",
        channel_parent_type: "guild",
        channel_parent_id: "650779094005186335",
      }),
    ).toEqual({
      id: "634415832",
      name: "general",
      parent: { type: "guild", id: "650779094005186335" },
    });
  });

  it("toConsoleChannel builds from message channel with resolved names", () => {
    expect(
      toConsoleChannel(
        {
          id: "634415832",
          type: "channel",
          parent: { type: "guild", id: "650779094005186335" },
        },
        { channelName: "general", parentName: "My Guild" },
      ),
    ).toEqual({
      id: "634415832",
      name: "general",
      parent: {
        type: "guild",
        id: "650779094005186335",
        name: "My Guild",
      },
    });
  });
});
