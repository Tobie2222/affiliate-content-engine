import type { Role } from '../org/OrgContext';
import type { PostStatus, Tone } from '../content/content';

export type AccountStatus = 'ACTIVE' | 'DISCONNECTED' | 'NEEDS_REAUTH';
export type JobStatus = 'QUEUED' | 'PUBLISHING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface SocialAccount {
  id: string;
  handle: string;
  displayName: string;
  mode: 'MOCK' | 'OFFICIAL';
  status: AccountStatus;
  createdAt: string;
}

export interface PublishJob {
  id: string;
  socialAccountId: string;
  contentVersion: number;
  scheduledFor: string;
  status: JobStatus;
  attempts: number;
  failureKind: 'NOT_SENT' | 'UNKNOWN' | null;
  retrySafe: boolean | null;
  lastError: string | null;
  createdAt: string;
}

export interface PublishedInfo {
  id: string;
  socialAccountId: string;
  externalPostId: string;
  permalink: string | null;
  publishedAt: string;
}

/** `jobs` mới nhất trước (máy chủ trả theo thứ tự này). */
export interface PostPublishing {
  jobs: PublishJob[];
  published: PublishedInfo | null;
}

/** Khớp ROLE_PERMISSIONS ở máy chủ: publish.manage và social.manage. Máy chủ vẫn kiểm tra lại. */
export function canSchedulePosts(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'CONTENT_EDITOR';
}

export function canManageAccounts(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  DISCONNECTED: 'Đã ngắt kết nối',
  NEEDS_REAUTH: 'Cần kết nối lại',
};

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, Tone> = {
  ACTIVE: 'good',
  DISCONNECTED: 'neutral',
  NEEDS_REAUTH: 'wait',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: 'Đang chờ đến giờ',
  PUBLISHING: 'Đang đăng',
  SUCCEEDED: 'Đã đăng',
  FAILED: 'Thất bại',
  CANCELLED: 'Đã hủy',
};

export function accountLabel(a: Pick<SocialAccount, 'handle' | 'displayName' | 'mode'>): string {
  return `@${a.handle} (${a.displayName})${a.mode === 'MOCK' ? ' - giả lập' : ''}`;
}

export function activeAccounts(accounts: SocialAccount[]): SocialAccount[] {
  return accounts.filter((a) => a.status === 'ACTIVE');
}

// ---------- Thời gian (giờ Việt Nam, UTC+7) ----------

const VN_OFFSET_MS = 7 * 60 * 60_000;
const MIN_LEAD_MINUTES = 2;
const MAX_SCHEDULE_DAYS = 60;

/** Giá trị của ô datetime-local ("2026-10-30T09:00", hiểu là giờ Việt Nam) -> ISO UTC. Null nếu không hợp lệ. */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    return null;
  }
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) - VN_OFFSET_MS;
  const back = new Date(utc + VN_OFFSET_MS);
  // Ngày không tồn tại (ví dụ 31/02) bị Date cuốn sang tháng sau: so lại từng thành phần.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) {
    return null;
  }
  return new Date(utc).toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO/Date -> giá trị cho ô datetime-local theo giờ Việt Nam. */
export function toLocalInput(date: Date): string {
  const t = new Date(date.getTime() + VN_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Gợi ý mặc định: 30 phút nữa, làm tròn lên bội số của 5 phút. */
export function defaultScheduleInput(now: Date): string {
  const slot = 5 * 60_000;
  const rounded = Math.ceil((now.getTime() + 30 * 60_000) / slot) * slot;
  return toLocalInput(new Date(rounded));
}

/** Thông báo lỗi hoặc null. Khớp quy tắc máy chủ: sau hiện tại ít nhất 2 phút, tối đa 60 ngày. */
export function validateScheduleInput(value: string, accountId: string, now: Date): string | null {
  if (accountId === '') {
    return 'Hãy chọn tài khoản Threads.';
  }
  const iso = localInputToIso(value);
  if (!iso) {
    return 'Hãy chọn ngày và giờ đăng hợp lệ.';
  }
  const minutes = (new Date(iso).getTime() - now.getTime()) / 60_000;
  if (minutes < MIN_LEAD_MINUTES) {
    return `Giờ đăng phải sau hiện tại ít nhất ${MIN_LEAD_MINUTES} phút.`;
  }
  if (minutes > MAX_SCHEDULE_DAYS * 24 * 60) {
    return `Chỉ lên lịch được tối đa ${MAX_SCHEDULE_DAYS} ngày tới.`;
  }
  return null;
}

export function formatVN(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', hour12: false });
}

// ---------- Thao tác theo trạng thái ----------

export interface PublishActions {
  canSchedule: boolean;
  canUnschedule: boolean;
  canRetry: boolean;
  /** Lần đăng trước không rõ kết quả: phải xác nhận đã kiểm tra trên Threads trước khi thử lại. */
  retryNeedsConfirm: boolean;
}

export function publishActions(status: PostStatus, jobs: PublishJob[], role: Role): PublishActions {
  const allowed = canSchedulePosts(role);
  const lastFailed = jobs.find((j) => j.status === 'FAILED') ?? null;
  return {
    canSchedule: allowed && status === 'APPROVED',
    canUnschedule: allowed && status === 'SCHEDULED',
    canRetry: allowed && status === 'FAILED' && lastFailed !== null,
    retryNeedsConfirm: lastFailed !== null && lastFailed.retrySafe !== true,
  };
}

/** Giải thích lỗi đăng bằng lời thường, nói rõ có thể thử lại an toàn hay không. */
export function failureText(job: Pick<PublishJob, 'failureKind' | 'lastError'>): string {
  const detail = job.lastError ? ` (${job.lastError})` : '';
  if (job.failureKind === 'NOT_SENT') {
    return `Bài chưa được gửi đi nên thử lại an toàn.${detail}`;
  }
  return `Không rõ bài đã lên Threads hay chưa. Hãy kiểm tra trực tiếp trên Threads trước khi thử lại.${detail}`;
}

export const PUBLISH_STATUS_HINT: Partial<Record<PostStatus, string>> = {
  APPROVED: 'Bài đã được duyệt. Người có quyền lên lịch sẽ chọn tài khoản và giờ đăng.',
  SCHEDULED: 'Bài đã lên lịch và đang chờ đến giờ đăng.',
  PUBLISHING: 'Bài đang được gửi lên Threads.',
  PUBLISHED: 'Bài đã được đăng.',
  FAILED: 'Đăng bài thất bại.',
};
