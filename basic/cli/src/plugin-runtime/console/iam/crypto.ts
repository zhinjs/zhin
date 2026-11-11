import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** ADR 0049 §2: scrypt N=2^15, r=8, p=1, 32-byte salt. */
const SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 });

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 1024;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return '密码必须是字符串';
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  if (password.length > PASSWORD_MAX_LENGTH) return '密码过长';
  return null;
}

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number; keyLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, params.keyLength, {
      N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem,
    }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(value => Number.isSafeInteger(value) && value! > 0) || N! > 2 ** 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length < 16 || expected.length < 16) return false;
  const actual = await derive(password, salt, { N: N!, r: r!, p: p!, keyLength: expected.length });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;
/** Burns the same work as a real check so unknown usernames are not faster. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummyHash);
  return false;
}

/** 32 random bytes, base64url (ADR 0049 §2). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newId(): string {
  return randomBytes(16).toString('hex');
}
