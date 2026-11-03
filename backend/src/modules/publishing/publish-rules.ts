export const MIN_LEAD_MINUTES = 2;
export const MAX_SCHEDULE_DAYS = 60;
/** Việc ở trạng thái PUBLISHING quá lâu: coi như không rõ kết quả. */
export const STALE_PUBLISHING_MINUTES = 10;
export const MAX_ERROR_CHARS = 500;
/** Comment đang gửi quá lâu: coi như không rõ kết quả. */
export const STALE_COMMENT_MINUTES = 10;
/** Bài đã đăng nhưng comment vẫn PENDING quá lâu (tiến trình dừng giữa chừng): worker sẽ đăng bù. */
export const COMMENT_PICKUP_SECONDS = 30;

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

const THREADS_HOSTS = new Set(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com']);

export interface ParsedThreadsPermalink {
  handle: string;
  code: string;
  /** Link chuẩn hóa: bỏ tham số truy vấn và đoạn #. */
  url: string;
}

/** Đọc link bài Threads dạng https://www.threads.net/@ten/post/MÃ. Trả null nếu không đúng dạng. */
export function parseThreadsPermalink(raw: string): ParsedThreadsPermalink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !THREADS_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) {
    return null;
  }
  const match = /^\/@([A-Za-z0-9._]{1,30})\/post\/([A-Za-z0-9_-]{5,40})\/?$/.exec(url.pathname);
  if (!match) {
    return null;
  }
  const handle = match[1].toLowerCase();
  return { handle, code: match[2], url: `https://${url.hostname.toLowerCase()}/@${handle}/post/${match[2]}` };
}

/** Ngày giờ người dùng khai khi đánh dấu đã đăng thủ công: không ở tương lai (cho lệch đồng hồ 5 phút). */
export function validateManualPublishedAt(at: Date, notBefore: Date, now: Date): ScheduleTimeCheck {
  if (Number.isNaN(at.getTime())) {
    return { ok: false, reason: 'Thời điểm đăng không hợp lệ.' };
  }
  if (at.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: 'Thời điểm đã đăng không được ở tương lai.' };
  }
  if (at.getTime() < notBefore.getTime()) {
    return { ok: false, reason: 'Thời điểm đã đăng không được sớm hơn lúc bài được lên lịch.' };
  }
  return { ok: true };
}

/** Nội dung comment chứa link affiliate. Dòng công khai hoa hồng nằm ở bài chính. */
export function composeCommentText(affiliateUrl: string): string {
  return `Link sản phẩm: ${affiliateUrl}`;
}

/** Token Threads chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới. Chặn ký tự lạ (xuống dòng, khoảng trắng...) trước khi dùng. */
export function isPlausibleAccessToken(token: string): boolean {
  return /^[A-Za-z0-9._-]{20,2000}$/.test(token);
}
