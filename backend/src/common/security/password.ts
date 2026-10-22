import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt có sẵn trong Node, không cần module native (tránh lỗi biên dịch trên Windows).
const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 128 * 1024 * 1024;
const MAX_N = 2 ** 20;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LEN,
      { N: n, r, p, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Định dạng lưu: scrypt$N$r$p$salt(base64)$hash(base64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const validParams =
    Number.isInteger(n) && n >= 2 && n <= MAX_N && (n & (n - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 && r <= 32 &&
    Number.isInteger(p) && p >= 1 && p <= 16;
  if (!validParams) {
    return false;
  }
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  try {
    const actual = await derive(password, salt, n, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Hash giả để đăng nhập với email không tồn tại cũng tốn thời gian như email có thật,
 * tránh lộ email nào đã đăng ký qua độ trễ phản hồi.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHash;
}
