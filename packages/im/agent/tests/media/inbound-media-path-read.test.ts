import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeInboundMediaPath, readInboundMediaFile } from '../../src/media/inbound-media-path.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let base: string;
let owned: string;
let elsewhere: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-read-')));
  owned = path.join(base, 'endpoint', 'media', 'inbound');
  elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(path.join(owned, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(elsewhere, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(owned, 'sub', 'pic.png'), PNG);
  fs.writeFileSync(path.join(elsewhere, 'sub', 'pic.png'), Buffer.from('SECRET'));
  fs.writeFileSync(path.join(elsewhere, 'secret.png'), Buffer.from('SECRET'));
});
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

async function authorized(file: string) {
  const decision = await authorizeInboundMediaPath(file, [owned]);
  if (!decision.allowed) throw new Error(`not allowed: ${decision.reason}`);
  return decision;
}

describe('readInboundMediaFile (#1250 review: TOCTOU)', () => {
  it('reads an authorized file through one descriptor', async () => {
    const decision = await authorized(path.join(owned, 'sub', 'pic.png'));
    expect(decision.root).toBe(owned);
    expect(await readInboundMediaFile(decision, 1024)).toEqual(PNG);
    expect(await readInboundMediaFile(decision, 4)).toBeUndefined();
  });

  it('refuses a file swapped for a symbolic link after authorization', async () => {
    const file = path.join(owned, 'sub', 'pic.png');
    const decision = await authorized(file);
    fs.rmSync(file);
    fs.symlinkSync(path.join(elsewhere, 'secret.png'), file);
    expect(await readInboundMediaFile(decision, 1024)).toBeUndefined();
  });

  it('refuses a parent directory swapped for a symbolic link after authorization', async () => {
    const decision = await authorized(path.join(owned, 'sub', 'pic.png'));
    fs.rmSync(path.join(owned, 'sub'), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'sub'), path.join(owned, 'sub'));
    expect(await readInboundMediaFile(decision, 1024)).toBeUndefined();
  });

  it('refuses a file replaced by a directory', async () => {
    const file = path.join(owned, 'sub', 'pic.png');
    const decision = await authorized(file);
    fs.rmSync(file);
    fs.mkdirSync(file);
    expect(await readInboundMediaFile(decision, 1024)).toBeUndefined();
  });
});
