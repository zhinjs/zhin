/**
 * ADR 0060 §3.3: `zhin status` shows the chat owner claim code that the instance writes while no
 * global chat owner exists. The instance owns the file (`.zhin/chat-owner-claim.json`, mode 0600;
 * path kept in sync with `packages/im/zhin/src/instance/chat-owner-claim.ts`, which the CLI must
 * not import); the code is shown only when the file belongs to the running instance.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CHAT_OWNER_CLAIM_FILE = join('.zhin', 'chat-owner-claim.json');

export interface ChatOwnerClaimInfo {
  readonly code: string;
  readonly pid: number;
  readonly createdAt: number;
}

/**
 * The open claim of the running instance: the file's pid is the instance's, or it was written
 * after the instance started (a wrapper process may report another pid). Undefined when none,
 * unreadable or stale.
 */
export async function readChatOwnerClaim(root: string, instance: Readonly<{ pid?: number; startedAt?: number }>): Promise<ChatOwnerClaimInfo | undefined> {
  let value: Partial<ChatOwnerClaimInfo>;
  try { value = JSON.parse(await readFile(join(root, CHAT_OWNER_CLAIM_FILE), 'utf8')) as Partial<ChatOwnerClaimInfo>; } catch { return undefined; }
  if (typeof value.code !== 'string' || !/^[A-Z2-9]{8}$/u.test(value.code)) return undefined;
  const createdAt = Number(value.createdAt) || 0;
  const current = (instance.pid !== undefined && value.pid === instance.pid)
    || (instance.startedAt !== undefined && createdAt >= instance.startedAt);
  if (!current) return undefined;
  return { code: value.code, pid: Number(value.pid) || 0, createdAt };
}

export function renderChatOwnerClaim(claim: ChatOwnerClaimInfo): string[] {
  return [
    `聊天主人：尚无全局 owner。私聊机器人发送「认领 ${claim.code}」（claim ${claim.code}）即可认领；`,
    '  认领码一次性，实例重启后轮换；也可在 Console「聊天角色」页授予。',
  ];
}
