export type RefreshVerdict = 'OK' | 'UNKNOWN' | 'EXPIRED' | 'REUSED';

export interface RefreshRecordView {
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Quyết định cho một lần làm mới token.
 * - REUSED: token đã bị thu hồi mà vẫn được dùng lại -> nghi bị đánh cắp,
 *   người gọi phải thu hồi toàn bộ "gia đình" token đó.
 */
export function evaluateRefresh(
  record: RefreshRecordView | null,
  now: Date,
): RefreshVerdict {
  if (!record) {
    return 'UNKNOWN';
  }
  if (record.revokedAt) {
    return 'REUSED';
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return 'OK';
}
