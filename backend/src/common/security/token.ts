import { createHash, randomBytes } from 'node:crypto';

/** Refresh token ngẫu nhiên (opaque). Chỉ lưu hash trong DB, không lưu bản gốc. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
