import { describe, expect, it } from "vitest";
import { parseRelativeDelayMs } from "../src/duration.js";
import { ReminderInputError } from "../src/service.js";
import { reminderActorFromTool } from "../src/tool-actor.js";
import { adapterFeatureId } from "zhin.js/adapter";

describe("parseRelativeDelayMs", () => {
  it("parses seconds, minutes, hours and days", () => {
    expect(parseRelativeDelayMs("600")).toBe(600_000);
    expect(parseRelativeDelayMs("10m")).toBe(600_000);
    expect(parseRelativeDelayMs("2h")).toBe(7_200_000);
    expect(parseRelativeDelayMs("1d")).toBe(86_400_000);
  });
  it("rejects empty or invalid input", () => {
    expect(() => parseRelativeDelayMs("")).toThrow();
    expect(() => parseRelativeDelayMs("10x")).toThrow();
  });
});

describe("reminderActorFromTool", () => {
  it("preserves the trusted canonical parent and thread and rejects mismatched identity", () => {
    const conversation = { endpoint: { adapter: 'sandbox', id: 'cap-1' }, kind: 'channel' as const,
      id: 'room', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 'topic' };
    const context = { locale: 'en' as const, origin: { kind: 'im' as const, platform: 'sandbox', endpoint: 'main',
      scope: 'channel' as const, sceneId: 'room', threadId: 'topic', conversation },
      principal: { subjectId: 'alice', roles: [] },
      project: () => ({ describe: () => [{ id: 'cap-1', name: 'main' }], clientAdapter: () => 'sandbox' }) as never };
    expect(reminderActorFromTool(context)).toEqual({ senderId: 'alice', target: conversation, locale: 'en' });
    expect(() => reminderActorFromTool({ ...context, origin: { ...context.origin, conversation: { ...conversation,
      endpoint: { adapter: 'sandbox', id: 'other-account' } } } })).toThrow('Could not identify');
    expect(() => reminderActorFromTool({ ...context, origin: { ...context.origin, threadId: 'other-thread' } })).toThrow('Could not identify');
  });

  it("resolves IM origin through AdapterIndex", () => {
    const actor = reminderActorFromTool({
      origin: {
        kind: "im",
        platform: "sandbox",
        endpoint: "main",
        scope: "channel",
        sceneId: "room",
        threadId: "topic",
      },
      principal: { subjectId: "alice", roles: [] },
      project(feature) {
        expect(feature).toBe(adapterFeatureId);
        return {
          describe: () => [{ id: "cap-1", name: "main" }],
          clientAdapter: () => "sandbox",
        } as never;
      },
    });
    expect(actor.senderId).toBe("alice");
    expect(actor.target).toEqual({
      endpoint: { adapter: "sandbox", id: "cap-1" },
      kind: "channel",
      id: "room",
      threadId: "topic",
    });
  });

  it("rejects non-IM origins", () => {
    expect(() =>
      reminderActorFromTool({
        origin: { kind: "schedule", jobId: "j1" },
        principal: { subjectId: "alice", roles: [] },
        project: () => {
          throw new Error("unused");
        },
      })
    ).toThrow(ReminderInputError);
  });
});
