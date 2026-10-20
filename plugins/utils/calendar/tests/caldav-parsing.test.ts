import { describe, expect, it } from "vitest";
import { extractHrefs, extractVeventBlocks } from "../src/caldav.js";
import { buildRedirectUri } from "../src/chat-auth.js";

describe("CalDAV scanning helpers", () => {
  it("extracts hrefs with and without namespace prefixes", () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<d:multistatus xmlns:d="DAV:">',
      "<d:response><d:href> /cal/a.ics </d:href></d:response>",
      "<response><href>/cal/b.ics</href></response>",
      "<D:HREF>/cal/c.ics</D:HREF>",
      "<d:hrefx>ignored</d:hrefx>",
      "</d:multistatus>",
    ].join("\n");
    expect(extractHrefs(xml)).toEqual([
      "/cal/a.ics",
      "/cal/b.ics",
      "/cal/c.ics",
    ]);
  });

  it("extracts VEVENT bodies and ignores an unterminated block", () => {
    const text =
      "BEGIN:VEVENT\nUID:1\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nEND:VEVENT\nBEGIN:VEVENT\nUID:3";
    expect(extractVeventBlocks(text)).toEqual(["\nUID:1\n", "\nUID:2\n"]);
  });

  it("handles long adversarial input quickly", () => {
    const hostile = "<a:".repeat(50_000) + "BEGIN:VEVENT".repeat(20_000);
    const startedAt = Date.now();
    extractHrefs(hostile);
    extractVeventBlocks(hostile);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("trims slashes when building redirect URIs", () => {
    expect(buildRedirectUri("https://x.dev////", "///cb")).toBe(
      "https://x.dev/cb"
    );
    expect(buildRedirectUri("https://x.dev", "cb")).toBe("https://x.dev/cb");
    expect(buildRedirectUri(`https://x.dev${"/".repeat(100_000)}`, "cb")).toBe(
      "https://x.dev/cb"
    );
  });
});
