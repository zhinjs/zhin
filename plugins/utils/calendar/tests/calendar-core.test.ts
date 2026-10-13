import { describe, expect, it } from "vitest";
import { parseCalDavEvents } from "../src/caldav.js";
import { findFreeSlots } from "../src/free-time.js";
import { cleanSecret } from "../src/secrets.js";
import {
  formatInZone,
  parseDateTimeInZone,
  parseDuration,
} from "../src/time.js";

describe("time helpers", () => {
  it("parses zoned wall time and durations", () => {
    const date = parseDateTimeInZone("2026-10-13T15:00", "Asia/Manila");
    expect(formatInZone(date, "Asia/Manila")).toBe("2026-10-13 15:00");
    expect(parseDuration("2h30m")).toBe(2 * 3600000 + 30 * 60000);
  });
});

describe("parseCalDavEvents", () => {
  it("reads VEVENT blocks", () => {
    const xml = [
      "BEGIN:VEVENT",
      "UID:abc",
      "SUMMARY:Standup",
      "DTSTART:20261013T020000Z",
      "DTEND:20261013T023000Z",
      "END:VEVENT",
    ].join("\n");
    const events = parseCalDavEvents(
      `<C:calendar-data>${xml}</C:calendar-data>`,
      "UTC"
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Standup");
    expect(events[0]?.id).toBe("abc");
  });
});

describe("findFreeSlots", () => {
  it("returns gaps between busy events inside work hours", () => {
    const slots = findFreeSlots({
      from: parseDateTimeInZone("2026-10-13T08:00", "Asia/Manila"),
      to: parseDateTimeInZone("2026-10-13T18:00", "Asia/Manila"),
      durationMinutes: 60,
      workDayStart: "09:00",
      workDayEnd: "17:00",
      timezone: "Asia/Manila",
      events: [
        {
          id: "1",
          title: "standup",
          start: "2026-10-13 10:00",
          end: "2026-10-13 11:00",
        },
      ],
    });
    expect(
      slots.some(
        (slot) =>
          slot.start === "2026-10-13 09:00" && slot.end === "2026-10-13 10:00"
      )
    ).toBe(true);
    expect(slots.some((slot) => slot.start === "2026-10-13 11:00")).toBe(true);
  });
});

describe("cleanSecret", () => {
  it("blanks unresolved env placeholders", () => {
    expect(cleanSecret("${CALDAV_PASSWORD}")).toBe("");
    expect(cleanSecret(" secret ")).toBe("secret");
  });
});
