import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalModelCredentialVault } from '../../../src/plugin-runtime/personal-models/credential-vault.js';

let root: string;
let directory: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zhin-personal-vault-')); directory = join(root, 'vault'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const filename = (ref: string) => `${createHash('sha256').update(ref).digest('hex')}.json`;

describe('Host personal model credential vault', () => {
  it('persists only encrypted keys and an opaque reference; reopens after restart', async () => {
    const vault = createPersonalModelCredentialVault({ directory });
    const apiKey = 'synthetic-test-api-key';
    const secretRef = await vault.put({ ownerId: 'owner-a', apiKey });
    expect(secretRef).toMatch(/^personal-model-secret:v1:[a-f0-9]{48}$/);
    expect(await vault.resolve({ ownerId: 'owner-a', secretRef })).toBe(apiKey);
    const reopened = createPersonalModelCredentialVault({ directory });
    expect(await reopened.resolve({ ownerId: 'owner-a', secretRef })).toBe(apiKey);
    expect(Object.isFrozen(vault)).toBe(true);
    expect(JSON.stringify(vault)).not.toContain(apiKey);
    const files = await readdir(directory);
    expect(files.sort()).toEqual([filename(secretRef), 'root-key.json'].sort());
    for (const file of files) {
      expect(await readFile(join(directory, file), 'utf8')).not.toContain(apiKey);
      if (process.platform !== 'win32') expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
    }
    if (process.platform !== 'win32') expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  it('binds ciphertext to owner and reference and returns safe errors for tampering', async () => {
    const vault = createPersonalModelCredentialVault({ directory });
    const secretRef = await vault.put({ ownerId: 'a', apiKey: 'synthetic-secret' });
    await expect(vault.resolve({ ownerId: 'b', secretRef })).rejects.toMatchObject({ code: 'integrity' });
    const otherRef = await vault.put({ ownerId: 'a', apiKey: 'other-synthetic-secret' });
    await writeFile(join(directory, filename(otherRef)), await readFile(join(directory, filename(secretRef))));
    await expect(vault.resolve({ ownerId: 'a', secretRef: otherRef })).rejects.toMatchObject({ code: 'integrity' });
    const error = await vault.resolve({ ownerId: 'b', secretRef }).catch(value => value);
    expect(String(error)).not.toContain('synthetic-secret');
    expect(error.cause).toBeUndefined();
  });

  it('keeps distinct errors for absence, malformed references, corrupted ciphertext and missing master', async () => {
    const vault = createPersonalModelCredentialVault({ directory });
    await expect(vault.resolve({ ownerId: 'a', secretRef: 'personal-model-secret:v1:' + '0'.repeat(48) })).rejects.toMatchObject({ code: 'not_found' });
    await expect(vault.resolve({ ownerId: 'a', secretRef: '../../secret' })).rejects.toMatchObject({ code: 'invalid_input' });
    const secretRef = await vault.put({ ownerId: 'a', apiKey: 'synthetic-secret' });
    const path = join(directory, filename(secretRef));
    const original = await readFile(path);
    for (const payload of ['invalid json', '{}', JSON.stringify({ version: 1, iv: '', tag: '', ciphertext: '' })]) {
      await writeFile(path, payload);
      await expect(vault.resolve({ ownerId: 'a', secretRef })).rejects.toMatchObject({ code: 'integrity' });
    }
    await writeFile(path, original);
    await rm(join(directory, 'root-key.json'));
    await expect(createPersonalModelCredentialVault({ directory }).resolve({ ownerId: 'a', secretRef })).rejects.toMatchObject({ code: 'integrity' });
    expect(await readdir(directory)).toEqual([filename(secretRef)]);
  });

  it('never replaces corrupted or insecure master keys', async () => {
    const vault = createPersonalModelCredentialVault({ directory });
    await vault.put({ ownerId: 'a', apiKey: 'synthetic-first' });
    await writeFile(join(directory, 'root-key.json'), 'corrupted');
    await expect(createPersonalModelCredentialVault({ directory }).put({ ownerId: 'a', apiKey: 'synthetic-next' })).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(join(directory, 'root-key.json'), 'utf8')).toBe('corrupted');
    if (process.platform !== 'win32') {
      await chmod(join(directory, 'root-key.json'), 0o644);
      await expect(createPersonalModelCredentialVault({ directory }).put({ ownerId: 'a', apiKey: 'synthetic-next' })).rejects.toMatchObject({ code: 'integrity' });
    }
  });

  it('publishes one complete master under concurrent independent vault instances', async () => {
    const references = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      createPersonalModelCredentialVault({ directory }).put({ ownerId: 'a', apiKey: `synthetic-${index}` })));
    const reader = createPersonalModelCredentialVault({ directory });
    for (const [index, secretRef] of references.entries()) {
      expect(await reader.resolve({ ownerId: 'a', secretRef })).toBe(`synthetic-${index}`);
    }
    expect((await readdir(directory)).filter(file => file.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects symlinked directories and records without traversing them', async () => {
    const actual = join(root, 'actual');
    const actualVault = createPersonalModelCredentialVault({ directory: actual });
    const secretRef = await actualVault.put({ ownerId: 'a', apiKey: 'synthetic-secret' });
    await symlink(actual, directory);
    await expect(createPersonalModelCredentialVault({ directory }).put({ ownerId: 'a', apiKey: 'synthetic-next' })).rejects.toMatchObject({ code: 'storage' });
    await rm(directory);
    const target = join(root, 'external.json');
    await writeFile(target, 'external bytes', { mode: 0o600 });
    const record = join(actual, filename(secretRef));
    await rm(record); await symlink(target, record);
    await expect(actualVault.resolve({ ownerId: 'a', secretRef })).rejects.toMatchObject({ code: 'storage' });
    expect(await readFile(target, 'utf8')).toBe('external bytes');
  });
  it('can roll back only the fresh credential represented by its creation handle', async () => {
    const vault = createPersonalModelCredentialVault({ directory });
    const old = await vault.put({ ownerId: 'owner', apiKey: 'older-synthetic-key' });
    const fresh = await vault.prepare({ ownerId: 'owner', apiKey: 'fresh-synthetic-key' });
    await Promise.all([fresh.rollback(), fresh.rollback()]);
    await expect(vault.resolve({ ownerId: 'owner', secretRef: fresh.secretRef })).rejects.toMatchObject({ code: 'not_found' });
    expect(await vault.resolve({ ownerId: 'owner', secretRef: old })).toBe('older-synthetic-key');
  });

});
