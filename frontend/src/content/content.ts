import type { Role } from '../org/OrgContext';

export type PostStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'FAILED';

export type Severity = 'FAIL' | 'WARN';

export interface QaFinding {
  rule: string;
  severity: Severity;
  message: string;
}

export interface QaReport {
  ok: boolean;
  findings: QaFinding[];
  composedText: string;
  composedLength: number;
  /** Phiên bản nội dung mà báo cáo này đã kiểm tra. */
  forVersion: number;
  checkedAt: string;
}

export interface ApiPost {
  id: string;
  productId: string;
  affiliateLinkId: string;
  mediaAssetId: string | null;
  body: string;
  disclosureText: string;
  status: PostStatus;
  contentVersion: number;
  authorId: string | null;
  generatedBy: 'HUMAN' | 'AI';
  llmProvider: string | null;
  llmModel: string | null;
  blockedReason: string | null;
  qaReport: QaReport | null;
  qaCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPostVersion {
  id: string;
  version: number;
  body: string;
  disclosureText: string;
  editedBy: string | null;
  source: 'HUMAN' | 'AI';
  createdAt: string;
}

export interface ApiApproval {
  id: string;
  contentVersion: number;
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  reviewerId: string | null;
  note: string | null;
  createdAt: string;
}

export interface PostDetail {
  post: ApiPost;
  versions: ApiPostVersion[];
  approvals: ApiApproval[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: 'Bản nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  SCHEDULED: 'Đã lên lịch',
  PUBLISHING: 'Đang đăng',
  PUBLISHED: 'Đã đăng',
  CHANGES_REQUESTED: 'Cần sửa',
  REJECTED: 'Đã từ chối',
  BLOCKED: 'Bị chặn',
  FAILED: 'Đăng lỗi',
};

export type Tone = 'neutral' | 'wait' | 'good' | 'bad';

export const STATUS_TONE: Record<PostStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'wait',
  APPROVED: 'good',
  SCHEDULED: 'good',
  PUBLISHING: 'wait',
  PUBLISHED: 'good',
  CHANGES_REQUESTED: 'wait',
  REJECTED: 'bad',
  BLOCKED: 'bad',
  FAILED: 'bad',
};

export const STATUS_FILTERS: ReadonlyArray<PostStatus> = [
  'DRAFT',
  'PENDING_APPROVAL',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'BLOCKED',
];

export const RULE_LABEL: Record<string, string> = {
  EMPTY_BODY: 'Nội dung trống',
  PLACEHOLDER_LEFT: 'Còn nhãn [MẪU]',
  LENGTH: 'Độ dài',
  DISCLOSURE: 'Dòng công khai hoa hồng',
  LINK_PRESENT: 'Link affiliate',
  EXTRA_URL: 'Link thừa trong nội dung',
  BANNED_CLAIM: 'Cam kết bị cấm',
  SUPERLATIVE: 'Từ so sánh tuyệt đối',
  PRICE_CLAIM: 'Giá nêu trong bài',
  DISCOUNT_CLAIM: 'Mức giảm giá',
  DUPLICATE: 'Trùng bài gần đây',
  LINK_STATUS: 'Trạng thái link',
  MEDIA_RIGHTS: 'Giấy phép media',
};

export const DECISION_LABEL: Record<ApiApproval['decision'], string> = {
  APPROVED: 'Đã duyệt',
  CHANGES_REQUESTED: 'Yêu cầu sửa',
  REJECTED: 'Từ chối',
};

export const DEFAULT_DISCLOSURE = 'Mình nhận hoa hồng nếu bạn mua qua link này.';
export const THREADS_MAX_CHARS = 500;
export const THREADS_WARN_CHARS = 470;
export const MIN_NOTE_CHARS = 5;

/** Đếm theo ký tự Unicode (emoji tính là 1), giống bộ kiểm tra ở máy chủ. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/** Ghép bài đăng như máy chủ: nội dung, dòng công khai, rồi link. Chỉ để gợi ý khi gõ; máy chủ mới là nơi quyết định. */
export function composePreview(body: string, disclosure: string, url: string | null): string {
  return [body.trim(), disclosure.trim(), url?.trim() ?? ''].filter((part) => part !== '').join('\n\n').replace(/\n\n(https?:\/\/\S+)$/, '\n$1');
}

export type LengthState = 'ok' | 'near' | 'over';

export function lengthState(chars: number): LengthState {
  if (chars > THREADS_MAX_CHARS) {
    return 'over';
  }
  return chars >= THREADS_WARN_CHARS ? 'near' : 'ok';
}

const WRITE_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'CONTENT_EDITOR'];
const REVIEW_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'REVIEWER'];

/** Khớp ROLE_PERMISSIONS ở máy chủ (content.write / content.review). Máy chủ vẫn kiểm tra lại mọi yêu cầu. */
export function canWriteContent(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}

export function canReviewContent(role: Role): boolean {
  return REVIEW_ROLES.includes(role);
}

/** Chỉ OWNER có quyền org.manage (đổi cài đặt tổ chức). */
export function canManageOrg(role: Role): boolean {
  return role === 'OWNER';
}

const EDITABLE: ReadonlyArray<PostStatus> = ['DRAFT', 'CHANGES_REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'BLOCKED'];

export interface PostActions {
  canEdit: boolean;
  /** Sửa bài đang chờ duyệt/đã duyệt sẽ làm mất hiệu lực lần duyệt. */
  editResetsApproval: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canReview: boolean;
  /** Người soạn cuối cùng không tự duyệt khi tách quyền bật. Vẫn được yêu cầu sửa hoặc từ chối. */
  approveBlockedReason: string | null;
}

export function postActions(
  post: Pick<ApiPost, 'status' | 'authorId'>,
  ctx: { role: Role; userId: string; separationOfDuties: boolean },
): PostActions {
  const write = canWriteContent(ctx.role);
  const review = canReviewContent(ctx.role) && post.status === 'PENDING_APPROVAL';
  const isAuthor = post.authorId !== null && post.authorId === ctx.userId;
  return {
    canEdit: write && EDITABLE.includes(post.status),
    editResetsApproval: post.status === 'PENDING_APPROVAL' || post.status === 'APPROVED',
    canSubmit: write && post.status === 'DRAFT',
    canWithdraw: write && post.status === 'PENDING_APPROVAL',
    canReview: review,
    approveBlockedReason:
      review && ctx.separationOfDuties && isAuthor
        ? 'Bạn là người soạn cuối cùng của bài này và tổ chức đang bật tách quyền, nên cần người khác duyệt. Bạn vẫn có thể yêu cầu sửa hoặc từ chối.'
        : null,
  };
}

export function qaIsCurrent(post: Pick<ApiPost, 'qaReport' | 'contentVersion'>): boolean {
  return post.qaReport !== null && post.qaReport.forVersion === post.contentVersion;
}

export function qaCounts(report: QaReport | null): { fail: number; warn: number } {
  const findings = report?.findings ?? [];
  return {
    fail: findings.filter((f) => f.severity === 'FAIL').length,
    warn: findings.filter((f) => f.severity === 'WARN').length,
  };
}

export type QaVerdict = 'unchecked' | 'stale' | 'fail' | 'warn' | 'pass';

/** Kết luận QA để hiển thị. 'stale' = báo cáo thuộc phiên bản cũ, phải chạy lại. */
export function qaVerdict(post: Pick<ApiPost, 'qaReport' | 'contentVersion'>): QaVerdict {
  if (!post.qaReport) {
    return 'unchecked';
  }
  if (!qaIsCurrent(post)) {
    return 'stale';
  }
  const { fail, warn } = qaCounts(post.qaReport);
  if (fail > 0) {
    return 'fail';
  }
  return warn > 0 ? 'warn' : 'pass';
}

export const VERDICT_LABEL: Record<QaVerdict, string> = {
  unchecked: 'Chưa kiểm tra',
  stale: 'Cần kiểm tra lại',
  fail: 'Có lỗi',
  warn: 'Có cảnh báo',
  pass: 'Đạt',
};

export const VERDICT_TONE: Record<QaVerdict, Tone> = {
  unchecked: 'neutral',
  stale: 'wait',
  fail: 'bad',
  warn: 'wait',
  pass: 'good',
};

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

/** Trả về thông báo lỗi, hoặc null nếu hợp lệ. Khớp quy tắc máy chủ: từ chối/yêu cầu sửa cần lý do tối thiểu 5 ký tự. */
export function validateReview(decision: ReviewDecision, note: string): string | null {
  if (decision !== 'APPROVE' && note.trim().length < MIN_NOTE_CHARS) {
    return `Hãy ghi lý do (tối thiểu ${MIN_NOTE_CHARS} ký tự).`;
  }
  return null;
}

/** Nhãn người dùng đọc được cho nguồn gốc bài; không lộ id nội bộ. */
export function originLabel(post: Pick<ApiPost, 'generatedBy' | 'llmProvider' | 'authorId'>): string {
  if (post.generatedBy === 'AI') {
    const edited = post.authorId !== null;
    const base = post.llmProvider === 'mock' ? 'AI mẫu (giả lập)' : 'AI đề xuất';
    return edited ? `${base}, đã được người chỉnh sửa` : base;
  }
  return 'Người soạn';
}

/** Rút gọn nội dung cho danh sách. */
export function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : flat;
}
