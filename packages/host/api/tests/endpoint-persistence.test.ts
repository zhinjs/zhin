import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  initBotPersistence,
  insertNotice,
} from "../src/endpoint-persistence.js";

const NOTICE_FILE = path.join(process.cwd(), "data", "console_bot_notices.json");

describe("endpoint-persistence", () => {
  let backup: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(NOTICE_FILE)) {
      backup = fs.readFileSync(NOTICE_FILE, "utf-8");
    }
  });

  afterEach(() => {
    if (backup !== null) {
      fs.writeFileSync(NOTICE_FILE, backup, "utf-8");
    } else if (fs.existsSync(NOTICE_FILE)) {
      fs.unlinkSync(NOTICE_FILE);
    }
  });

  it("数据库未启动时应回退到文件存储", async () => {
    initBotPersistence({
      inject: () => ({
        db: {
          isStarted: false,
          models: {
            get: () => ({
              create: async () => {
                throw new Error("Database not started");
              },
            }),
          },
        },
      }),
    });

    const row = await insertNotice({
      adapter: "icqq",
      endpoint_id: "8596238",
      notice_type: "group_member_increase",
      channel_type: "group",
      channel_id: "123",
      payload: "{}",
      created_at: Date.now(),
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.adapter).toBe("icqq");
    expect(fs.existsSync(NOTICE_FILE)).toBe(true);
  });
});
