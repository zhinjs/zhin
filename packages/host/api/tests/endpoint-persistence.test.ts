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
      platform_notice_id: "n1",
      type: "notice",
      scene_type: "group",
      scene_id: "123",
      sub_type: "member_increase",
      actor_id: "111",
      actor_name: "管理员",
      target_id: "222",
      target_name: "新成员",
      payload: "{}",
      created_at: Date.now(),
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.adapter).toBe("icqq");
    expect(fs.existsSync(NOTICE_FILE)).toBe(true);
  });
});
