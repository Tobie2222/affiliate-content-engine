import {
  ContentStateMachine,
  ContentStatus,
  ContentTransitionError,
  TransitionContext,
} from './content-state-machine';

const S = ContentStatus;
const ALL = Object.values(ContentStatus);

// Danh sách chuyển trạng thái hợp lệ, viết độc lập với bảng trong mã nguồn.
const ALLOWED: Array<[ContentStatus, ContentStatus]> = [
  [S.Draft, S.PendingApproval],
  [S.Draft, S.Blocked],
  [S.PendingApproval, S.Approved],
  [S.PendingApproval, S.ChangesRequested],
  [S.PendingApproval, S.Rejected],
  [S.PendingApproval, S.Draft],
  [S.PendingApproval, S.Blocked],
  [S.Approved, S.Scheduled],
  [S.Approved, S.Draft],
  [S.Approved, S.Blocked],
  [S.Scheduled, S.Publishing],
  [S.Scheduled, S.Approved],
  [S.Scheduled, S.Draft],
  [S.Scheduled, S.Blocked],
  [S.Publishing, S.Published],
  [S.Publishing, S.Failed],
  [S.ChangesRequested, S.Draft],
  [S.ChangesRequested, S.Blocked],
  [S.Blocked, S.Draft],
  [S.Failed, S.Scheduled],
  [S.Failed, S.Blocked],
];

const isAllowed = (from: ContentStatus, to: ContentStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

/** Ngữ cảnh "mọi thứ đều đạt" để kiểm tra riêng cấu trúc chuyển trạng thái. */
function goodContext(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    currentVersion: 2,
    approvedVersion: 2,
    actor: { isReviewer: true, isAuthor: false },
    separationOfDuties: true,
    checks: { socialAccountActive: true, affiliateLink: 'OK', mediaRights: 'OK' },
    retrySafe: true,
    reason: 'Giấy phép hết hạn',
    ...overrides,
  };
}

describe('ContentStateMachine - cấu trúc chuyển trạng thái', () => {
  const forbidden = ALL.flatMap((from) =>
    ALL.filter((to) => !isAllowed(from, to)).map((to) => [from, to] as [ContentStatus, ContentStatus]),
  );

  it.each(ALLOWED)('cho phép %s -> %s (ngữ cảnh hợp lệ)', (from, to) => {
    expect(ContentStateMachine.canTransition(from, to)).toBe(true);
    expect(ContentStateMachine.evaluate(from, to, goodContext())).toEqual({ ok: true });
  });

  it.each(forbidden)('cấm %s -> %s', (from, to) => {
    expect(ContentStateMachine.canTransition(from, to)).toBe(false);
    const result = ContentStateMachine.evaluate(from, to, goodContext());
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN_TRANSITION' });
    expect(() => ContentStateMachine.assert(from, to, goodContext())).toThrow(
      ContentTransitionError,
    );
  });

  it('bảng cấu trúc khớp danh sách mong đợi (không thiếu, không thừa)', () => {
    const actual = ALL.flatMap((from) =>
      ContentStateMachine.allowedTargets(from).map((to) => `${from}->${to}`),
    ).sort();
    const expected = ALLOWED.map(([f, t]) => `${f}->${t}`).sort();
    expect(actual).toEqual(expected);
  });

  it('PUBLISHED và REJECTED là trạng thái cuối', () => {
    expect(ContentStateMachine.isTerminal(S.Published)).toBe(true);
    expect(ContentStateMachine.isTerminal(S.Rejected)).toBe(true);
    expect(ContentStateMachine.isTerminal(S.Draft)).toBe(false);
  });

  it('bài đã đăng không bao giờ quay về DRAFT', () => {
    expect(ContentStateMachine.canTransition(S.Published, S.Draft)).toBe(false);
  });

  it('bài đang PUBLISHING không thể bị BLOCKED', () => {
    expect(ContentStateMachine.canTransition(S.Publishing, S.Blocked)).toBe(false);
  });
});

describe('ContentStateMachine - duyệt bài', () => {
  it('người không có quyền duyệt không thể APPROVE / REJECT / yêu cầu sửa', () => {
    const ctx = goodContext({ actor: { isReviewer: false, isAuthor: false } });
    for (const to of [S.Approved, S.Rejected, S.ChangesRequested]) {
      expect(ContentStateMachine.evaluate(S.PendingApproval, to, ctx)).toMatchObject({
        ok: false,
        code: 'GUARD_FAILED',
      });
    }
  });

  it('khi bật tách quyền, người soạn không được tự duyệt', () => {
    const ctx = goodContext({
      separationOfDuties: true,
      actor: { isReviewer: true, isAuthor: true },
    });
    expect(ContentStateMachine.evaluate(S.PendingApproval, S.Approved, ctx)).toMatchObject({
      ok: false,
      code: 'GUARD_FAILED',
    });
  });

  it('khi tắt tách quyền, người soạn có quyền duyệt thì duyệt được', () => {
    const ctx = goodContext({
      separationOfDuties: false,
      actor: { isReviewer: true, isAuthor: true },
    });
    expect(ContentStateMachine.evaluate(S.PendingApproval, S.Approved, ctx)).toEqual({ ok: true });
  });

  it('duyệt phiên bản cũ (khác phiên bản hiện tại) bị từ chối', () => {
    const ctx = goodContext({ currentVersion: 3, approvedVersion: 2 });
    expect(ContentStateMachine.evaluate(S.PendingApproval, S.Approved, ctx)).toMatchObject({
      ok: false,
      code: 'GUARD_FAILED',
    });
  });

  it('không có phiên bản duyệt thì không APPROVE được', () => {
    const ctx = goodContext({ approvedVersion: null });
    expect(ContentStateMachine.evaluate(S.PendingApproval, S.Approved, ctx)).toMatchObject({
      ok: false,
      code: 'GUARD_FAILED',
    });
  });
});

describe('ContentStateMachine - lên lịch và đăng', () => {
  const gated: Array<[ContentStatus, ContentStatus]> = [
    [S.Approved, S.Scheduled],
    [S.Scheduled, S.Publishing],
    [S.Failed, S.Scheduled],
  ];

  it.each(gated)('%s -> %s: sửa nội dung sau khi duyệt (lệch phiên bản) bị chặn', (from, to) => {
    const ctx = goodContext({ currentVersion: 3, approvedVersion: 2 });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toMatchObject({
      ok: false,
      code: 'GUARD_FAILED',
    });
  });

  it.each(gated)('%s -> %s: tài khoản không hoạt động bị chặn', (from, to) => {
    const ctx = goodContext({
      checks: { socialAccountActive: false, affiliateLink: 'OK', mediaRights: 'OK' },
    });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toMatchObject({ ok: false });
  });

  it.each(gated)('%s -> %s: link affiliate không hợp lệ bị chặn', (from, to) => {
    const ctx = goodContext({
      checks: { socialAccountActive: true, affiliateLink: 'FAILED', mediaRights: 'OK' },
    });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toMatchObject({ ok: false });
  });

  it.each(gated)('%s -> %s: giấy phép media hết hạn/không hợp lệ bị chặn', (from, to) => {
    const ctx = goodContext({
      checks: { socialAccountActive: true, affiliateLink: 'OK', mediaRights: 'FAILED' },
    });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toMatchObject({ ok: false });
  });

  it.each(gated)('%s -> %s: thiếu kết quả kiểm tra bị chặn', (from, to) => {
    const ctx = goodContext({ checks: undefined });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toMatchObject({ ok: false });
  });

  it.each(gated)('%s -> %s: bài không cần link/media (NOT_REQUIRED) vẫn đi tiếp được', (from, to) => {
    const ctx = goodContext({
      checks: { socialAccountActive: true, affiliateLink: 'NOT_REQUIRED', mediaRights: 'NOT_REQUIRED' },
    });
    expect(ContentStateMachine.evaluate(from, to, ctx)).toEqual({ ok: true });
  });

  it('FAILED -> SCHEDULED cần đối soát (retrySafe) trước', () => {
    expect(
      ContentStateMachine.evaluate(S.Failed, S.Scheduled, goodContext({ retrySafe: false })),
    ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
    expect(
      ContentStateMachine.evaluate(S.Failed, S.Scheduled, goodContext({ retrySafe: undefined })),
    ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
  });

  it('hủy lịch (SCHEDULED -> APPROVED) chỉ khi lần duyệt còn hiệu lực', () => {
    expect(
      ContentStateMachine.evaluate(S.Scheduled, S.Approved, goodContext({ currentVersion: 3 })),
    ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
    expect(ContentStateMachine.evaluate(S.Scheduled, S.Approved, goodContext())).toEqual({ ok: true });
  });
});

describe('ContentStateMachine - chặn bài (BLOCKED)', () => {
  it.each([S.Draft, S.PendingApproval, S.Approved, S.Scheduled, S.ChangesRequested, S.Failed])(
    '%s -> BLOCKED cần lý do',
    (from) => {
      expect(
        ContentStateMachine.evaluate(from, S.Blocked, goodContext({ reason: undefined })),
      ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
      expect(
        ContentStateMachine.evaluate(from, S.Blocked, goodContext({ reason: '   ' })),
      ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
      expect(ContentStateMachine.evaluate(from, S.Blocked, goodContext())).toEqual({ ok: true });
    },
  );
});

describe('ContentStateMachine.assert', () => {
  it('ném ContentTransitionError kèm mã và lý do', () => {
    try {
      ContentStateMachine.assert(S.Published, S.Draft, goodContext());
      throw new Error('lẽ ra phải ném lỗi');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentTransitionError);
      const err = e as ContentTransitionError;
      expect(err.code).toBe('FORBIDDEN_TRANSITION');
      expect(err.from).toBe(S.Published);
      expect(err.to).toBe(S.Draft);
    }
  });

  it('không ném lỗi khi hợp lệ', () => {
    expect(() => ContentStateMachine.assert(S.Draft, S.PendingApproval, goodContext())).not.toThrow();
  });
});
