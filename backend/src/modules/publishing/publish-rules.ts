export const MIN_LEAD_MINUTES = 2;
export const MAX_SCHEDULE_DAYS = 60;
/** Việc ở trạng thái PUBLISHING quá lâu: coi như không rõ kết quả. */
export const STALE_PUBLISHING_MINUTES = 10;
export const MAX_ERROR_CHARS = 500;

export type ScheduleTimeCheck = { ok: true } | { ok: false; reason: string };

/** Thời điểm đăng phải ở tương lai gần (tránh bấm nhầm quá khứ) nhưng không quá xa. */
export function validateScheduleTime(at: Date, now: Date): ScheduleTimeCheck {
  if (Number.isNaN(at.getTime())) {
    return { ok: false, reason: 'Thời điểm đăng không hợp lệ.' };
  }
  const diffMinutes = (at.getTime() - now.getTime()) / 60_000;
  if (diffMinutes < MIN_LEAD_MINUTES) {
    return { ok: false, reason: `Thời điểm đăng phải sau hiện tại ít nhất ${MIN_LEAD_MINUTES} phút.` };
  }
  if (diffMinutes > MAX_SCHEDULE_DAYS * 24 * 60) {
    return { ok: false, reason: `Chỉ lên lịch được tối đa ${MAX_SCHEDULE_DAYS} ngày tới.` };
  }
  return { ok: true };
}

/** Mỗi lần lên lịch là một ý định mới nên có khóa mới; cùng một việc thử lại thì giữ nguyên khóa. */
export function buildIdempotencyKey(postId: string, version: number, nonce: string): string {
  return `ace:${postId}:v${version}:${nonce}`;
}

/** Cắt và làm sạch thông điệp lỗi trước khi lưu: một dòng, không xuống dòng, giới hạn độ dài. */
export function sanitizeError(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CHARS);
}

export function isStalePublishing(startedAt: Date | null, now: Date): boolean {
  if (!startedAt) {
    return true;
  }
  return now.getTime() - startedAt.getTime() > STALE_PUBLISHING_MINUTES * 60_000;
}

export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}
