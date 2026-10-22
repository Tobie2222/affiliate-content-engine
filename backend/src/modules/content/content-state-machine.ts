export enum ContentStatus {
  Draft = 'DRAFT',
  PendingApproval = 'PENDING_APPROVAL',
  Approved = 'APPROVED',
  Scheduled = 'SCHEDULED',
  Publishing = 'PUBLISHING',
  Published = 'PUBLISHED',
  ChangesRequested = 'CHANGES_REQUESTED',
  Rejected = 'REJECTED',
  Blocked = 'BLOCKED',
  Failed = 'FAILED',
}

/** OK / FAILED / NOT_REQUIRED: người gọi quyết định bài có cần mục này hay không. */
export type RequirementState = 'OK' | 'FAILED' | 'NOT_REQUIRED';

export interface TransitionContext {
  /** Phiên bản nội dung hiện tại của bài. */
  currentVersion: number;
  /**
   * Phiên bản đã được duyệt. Với bước PENDING_APPROVAL -> APPROVED, đây là phiên bản
   * người duyệt vừa duyệt; với các bước sau, đây là phiên bản đã lưu của lần duyệt.
   */
  approvedVersion?: number | null;
  actor?: { isReviewer: boolean; isAuthor: boolean };
  /** Tổ chức bật tách quyền: người soạn không được tự duyệt bài của mình. */
  separationOfDuties?: boolean;
  /** Kiểm tra lại ngay trước khi lên lịch/đăng. */
  checks?: {
    socialAccountActive: boolean;
    affiliateLink: RequirementState;
    mediaRights: RequirementState;
  };
  /** Chỉ dùng cho FAILED -> SCHEDULED: đã đối soát, chắc chắn bài chưa được đăng. */
  retrySafe?: boolean;
  /** Bắt buộc khi chuyển sang BLOCKED. */
  reason?: string;
}

export type TransitionFailureCode = 'FORBIDDEN_TRANSITION' | 'GUARD_FAILED';

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: TransitionFailureCode; reason: string };

export class ContentTransitionError extends Error {
  constructor(
    readonly from: ContentStatus,
    readonly to: ContentStatus,
    readonly code: TransitionFailureCode,
    readonly reason: string,
  ) {
    super(`Không thể chuyển ${from} -> ${to}: ${reason}`);
    this.name = 'ContentTransitionError';
  }
}

const S = ContentStatus;

/**
 * Bảng chuyển trạng thái hợp lệ (cấu trúc). Điều kiện chi tiết nằm ở các guard bên dưới.
 *
 * Ghi chú thiết kế:
 * - PENDING_APPROVAL/APPROVED/SCHEDULED -> DRAFT: dùng khi sửa nội dung quan trọng
 *   (làm mất hiệu lực duyệt) hoặc rút bài lại; service phải tăng content_version.
 * - SCHEDULED -> APPROVED: hủy lịch đăng khi lần duyệt vẫn còn hiệu lực.
 * - BLOCKED -> DRAFT: sau khi khắc phục phải đi lại quy trình duyệt.
 * - PUBLISHED và REJECTED là trạng thái cuối; bài đã đăng không bao giờ quay về DRAFT.
 * - PUBLISHING không thể bị BLOCKED: bài đang gửi đi phải kết thúc bằng PUBLISHED hoặc FAILED.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ContentStatus, ReadonlyArray<ContentStatus>>> = {
  [S.Draft]: [S.PendingApproval, S.Blocked],
  [S.PendingApproval]: [S.Approved, S.ChangesRequested, S.Rejected, S.Draft, S.Blocked],
  [S.Approved]: [S.Scheduled, S.Draft, S.Blocked],
  [S.Scheduled]: [S.Publishing, S.Approved, S.Draft, S.Blocked],
  [S.Publishing]: [S.Published, S.Failed],
  [S.Published]: [],
  [S.ChangesRequested]: [S.Draft, S.Blocked],
  [S.Rejected]: [],
  [S.Blocked]: [S.Draft],
  [S.Failed]: [S.Scheduled, S.Blocked],
};

function fail(code: TransitionFailureCode, reason: string): TransitionResult {
  return { ok: false, code, reason };
}

function versionGuard(ctx: TransitionContext): TransitionResult | null {
  if (ctx.approvedVersion == null) {
    return fail('GUARD_FAILED', 'Bài chưa có phiên bản được duyệt.');
  }
  if (ctx.approvedVersion !== ctx.currentVersion) {
    return fail(
      'GUARD_FAILED',
      `Phiên bản duyệt (${ctx.approvedVersion}) khác phiên bản hiện tại (${ctx.currentVersion}).`,
    );
  }
  return null;
}

function runtimeChecksGuard(ctx: TransitionContext): TransitionResult | null {
  const checks = ctx.checks;
  if (!checks) {
    return fail('GUARD_FAILED', 'Thiếu kết quả kiểm tra tài khoản/link/giấy phép.');
  }
  if (!checks.socialAccountActive) {
    return fail('GUARD_FAILED', 'Tài khoản mạng xã hội không ở trạng thái hoạt động.');
  }
  if (checks.affiliateLink === 'FAILED') {
    return fail('GUARD_FAILED', 'Link affiliate không hợp lệ.');
  }
  if (checks.mediaRights === 'FAILED') {
    return fail('GUARD_FAILED', 'Giấy phép media không hợp lệ hoặc đã hết hạn.');
  }
  return null;
}

function reviewerGuard(ctx: TransitionContext): TransitionResult | null {
  if (!ctx.actor?.isReviewer) {
    return fail('GUARD_FAILED', 'Chỉ người có quyền duyệt mới thực hiện được.');
  }
  return null;
}

export class ContentStateMachine {
  static allowedTargets(from: ContentStatus): ReadonlyArray<ContentStatus> {
    return ALLOWED_TRANSITIONS[from];
  }

  static isTerminal(status: ContentStatus): boolean {
    return ALLOWED_TRANSITIONS[status].length === 0;
  }

  static canTransition(from: ContentStatus, to: ContentStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  /** Đánh giá chuyển trạng thái mà không ném lỗi. */
  static evaluate(
    from: ContentStatus,
    to: ContentStatus,
    ctx: TransitionContext,
  ): TransitionResult {
    if (!ContentStateMachine.canTransition(from, to)) {
      return fail('FORBIDDEN_TRANSITION', `Không cho phép chuyển ${from} -> ${to}.`);
    }

    const guards: Array<(c: TransitionContext) => TransitionResult | null> = [];

    switch (to) {
      case S.Approved:
        if (from === S.PendingApproval) {
          guards.push(reviewerGuard, ContentStateMachine.separationGuard, versionGuard);
        } else {
          // SCHEDULED -> APPROVED (hủy lịch): lần duyệt phải còn hiệu lực.
          guards.push(versionGuard);
        }
        break;
      case S.ChangesRequested:
      case S.Rejected:
        guards.push(reviewerGuard);
        break;
      case S.Scheduled:
        guards.push(versionGuard, runtimeChecksGuard);
        if (from === S.Failed) {
          guards.push(ContentStateMachine.retrySafeGuard);
        }
        break;
      case S.Publishing:
        guards.push(versionGuard, runtimeChecksGuard);
        break;
      case S.Blocked:
        guards.push(ContentStateMachine.reasonGuard);
        break;
      default:
        break;
    }

    for (const guard of guards) {
      const result = guard(ctx);
      if (result) {
        return result;
      }
    }
    return { ok: true };
  }

  /** Như evaluate nhưng ném ContentTransitionError khi bị từ chối. */
  static assert(from: ContentStatus, to: ContentStatus, ctx: TransitionContext): void {
    const result = ContentStateMachine.evaluate(from, to, ctx);
    if (!result.ok) {
      throw new ContentTransitionError(from, to, result.code, result.reason);
    }
  }

  private static separationGuard(ctx: TransitionContext): TransitionResult | null {
    if (ctx.separationOfDuties && ctx.actor?.isAuthor) {
      return fail('GUARD_FAILED', 'Người soạn không được tự duyệt bài của mình.');
    }
    return null;
  }

  private static retrySafeGuard(ctx: TransitionContext): TransitionResult | null {
    if (ctx.retrySafe !== true) {
      return fail('GUARD_FAILED', 'Cần đối soát kết quả đăng trước khi thử lại.');
    }
    return null;
  }

  private static reasonGuard(ctx: TransitionContext): TransitionResult | null {
    if (!ctx.reason || ctx.reason.trim().length === 0) {
      return fail('GUARD_FAILED', 'Chặn bài cần ghi rõ lý do.');
    }
    return null;
  }
}
