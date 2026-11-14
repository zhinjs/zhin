import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_OWNER_CLAIM_FILE, readChatOwnerClaim, renderChatOwnerClaim } from '../src/utils/chat-owner-claim.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function project(content?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-cli-claim-'));
  roots.push(root);
  if (content !== undefined) {
    await mkdir(join(root, '.zhin'), { recursive: true });
    await writeFile(join(root, CHAT_OWNER_CLAIM_FILE), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

describe('zhin status: chat owner claim (ADR 0060 §3.3)', () => {
  it('shows the code of the running instance only', async () => {
    const root = await project({ version: 1, code: 'ABCD2345', pid: 10, createdAt: 500 });
    expect(await readChatOwnerClaim(root, { pid: 10 })).toMatchObject({ code: 'ABCD2345' });
    // A wrapper pid: accepted when written after the instance started.
    expect(await readChatOwnerClaim(root, { pid: 11, startedAt: 400 })).toMatchObject({ code: 'ABCD2345' });
    // Stale file of an earlier instance.
    expect(await readChatOwnerClaim(root, { pid: 11, startedAt: 600 })).toBeUndefined();
    expect(renderChatOwnerClaim({ code: 'ABCD2345', pid: 10, createdAt: 500 }).join('\n')).toContain('认领 ABCD2345');
  });

  it('ignores missing or malformed files', async () => {
    expect(await readChatOwnerClaim(await project(), { pid: 1 })).toBeUndefined();
    expect(await readChatOwnerClaim(await project('{'), { pid: 1 })).toBeUndefined();
    expect(await readChatOwnerClaim(await project({ code: 'bad code', pid: 1 }), { pid: 1 })).toBeUndefined();
  });
});
