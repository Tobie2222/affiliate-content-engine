import { LinkItem, linkOptionLabel, mediaOptionLabel, mediaUsable, pickDefaultLink } from './catalog';
import {
  ApiPost,
  QaReport,
  composePreview,
  countChars,
  excerpt,
  lengthState,
  originLabel,
  postActions,
  qaCounts,
  qaVerdict,
  validateReview,
  canManageOrg,
  canReviewContent,
  canWriteContent,
} from './content';

const ME = 'user-me';

function report(over: Partial<QaReport> = {}): QaReport {
  return { ok: true, findings: [], composedText: '', composedLength: 0, forVersion: 1, checkedAt: '2026-10-27T03:00:00Z', ...over };
}

function post(over: Partial<ApiPost> = {}): ApiPost {
  return {
    id: 'p1',
    productId: 'a',
    affiliateLinkId: 'b',
    mediaAssetId: null,
    body: 'nội dung',
    disclosureText: 'công khai',
    status: 'DRAFT',
    contentVersion: 1,
    authorId: null,
    generatedBy: 'HUMAN',
    llmProvider: null,
    llmModel: null,
    blockedReason: null,
    qaReport: null,
    qaCheckedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const ctx = (role: 'OWNER' | 'ADMIN' | 'CONTENT_EDITOR' | 'REVIEWER' | 'ANALYST', separationOfDuties = true) => ({
  role,
  userId: ME,
  separationOfDuties,
});

describe('quyền theo vai trò (khớp backend)', () => {
  it('soạn bài: OWNER, ADMIN, CONTENT_EDITOR', () => {
    expect(['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'].map((r) => canWriteContent(r as never))).toEqual([true, true, true, false, false]);
  });
  it('duyệt bài: OWNER, ADMIN, REVIEWER', () => {
    expect(['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'].map((r) => canReviewContent(r as never))).toEqual([true, true, false, true, false]);
  });
  it('đổi cài đặt tổ chức: chỉ OWNER', () => {
    expect(canManageOrg('OWNER')).toBe(true);
    expect(canManageOrg('ADMIN')).toBe(false);
  });
});

describe('postActions', () => {
  it('bản nháp: biên tập viên sửa và gửi duyệt được, không duyệt được', () => {
    const a = postActions(post(), ctx('CONTENT_EDITOR'));
    expect(a).toMatchObject({ canEdit: true, canSubmit: true, canWithdraw: false, canReview: false });
  });

  it('chờ duyệt: người duyệt duyệt được nhưng không sửa được', () => {
    const a = postActions(post({ status: 'PENDING_APPROVAL' }), ctx('REVIEWER'));
    expect(a).toMatchObject({ canReview: true, canEdit: false, canSubmit: false });
    expect(a.approveBlockedReason).toBe(null);
  });

  it('tách quyền bật: người soạn cuối cùng không được bấm duyệt nhưng vẫn được từ chối', () => {
    const a = postActions(post({ status: 'PENDING_APPROVAL', authorId: ME }), ctx('OWNER', true));
    expect(a.canReview).toBe(true);
    expect(a.approveBlockedReason).not.toBe(null);
  });

  it('tách quyền tắt: người soạn tự duyệt được', () => {
    const a = postActions(post({ status: 'PENDING_APPROVAL', authorId: ME }), ctx('OWNER', false));
    expect(a.approveBlockedReason).toBe(null);
  });

  it('bản nháp AI chưa ai sửa (authorId rỗng) thì không bị chặn tự duyệt', () => {
    const a = postActions(post({ status: 'PENDING_APPROVAL', authorId: null, generatedBy: 'AI' }), ctx('OWNER', true));
    expect(a.approveBlockedReason).toBe(null);
  });

  it('sửa bài chờ duyệt/đã duyệt báo trước là sẽ mất hiệu lực duyệt', () => {
    expect(postActions(post({ status: 'PENDING_APPROVAL' }), ctx('OWNER')).editResetsApproval).toBe(true);
    expect(postActions(post({ status: 'APPROVED' }), ctx('OWNER')).editResetsApproval).toBe(true);
    expect(postActions(post({ status: 'DRAFT' }), ctx('OWNER')).editResetsApproval).toBe(false);
  });

  it('bài đã từ chối hoặc đã đăng: không còn thao tác nào', () => {
    for (const status of ['REJECTED', 'PUBLISHED', 'PUBLISHING'] as const) {
      const a = postActions(post({ status }), ctx('OWNER'));
      expect(a).toMatchObject({ canEdit: false, canSubmit: false, canWithdraw: false, canReview: false });
    }
  });

  it('phân tích viên chỉ xem', () => {
    const a = postActions(post({ status: 'DRAFT' }), ctx('ANALYST'));
    expect(a).toMatchObject({ canEdit: false, canSubmit: false, canReview: false });
  });
});

describe('QA', () => {
  it('kết luận theo báo cáo và phiên bản', () => {
    expect(qaVerdict(post())).toBe('unchecked');
    expect(qaVerdict(post({ qaReport: report({ forVersion: 1 }), contentVersion: 2 }))).toBe('stale');
    expect(qaVerdict(post({ qaReport: report() }))).toBe('pass');
    expect(qaVerdict(post({ qaReport: report({ findings: [{ rule: 'SUPERLATIVE', severity: 'WARN', message: 'x' }] }) }))).toBe('warn');
    expect(
      qaVerdict(post({ qaReport: report({ ok: false, findings: [{ rule: 'LENGTH', severity: 'FAIL', message: 'x' }, { rule: 'SUPERLATIVE', severity: 'WARN', message: 'y' }] }) })),
    ).toBe('fail');
  });

  it('đếm lỗi và cảnh báo', () => {
    const r = report({ findings: [{ rule: 'a', severity: 'FAIL', message: '' }, { rule: 'b', severity: 'WARN', message: '' }, { rule: 'c', severity: 'WARN', message: '' }] });
    expect(qaCounts(r)).toEqual({ fail: 1, warn: 2 });
    expect(qaCounts(null)).toEqual({ fail: 0, warn: 0 });
  });
});

describe('validateReview', () => {
  it('duyệt không cần lý do', () => {
    expect(validateReview('APPROVE', '')).toBe(null);
  });
  it('từ chối và yêu cầu sửa cần lý do tối thiểu 5 ký tự (bỏ khoảng trắng đầu/cuối)', () => {
    expect(validateReview('REJECT', '  ngắn ')).not.toBe(null);
    expect(validateReview('REQUEST_CHANGES', '')).not.toBe(null);
    expect(validateReview('REQUEST_CHANGES', 'Bỏ câu so sánh')).toBe(null);
  });
});

describe('độ dài và ghép bài', () => {
  it('emoji tính là một ký tự', () => {
    expect(countChars('ab😀')).toBe(3);
  });
  it('lengthState theo ngưỡng 470/500', () => {
    expect(lengthState(469)).toBe('ok');
    expect(lengthState(470)).toBe('near');
    expect(lengthState(500)).toBe('near');
    expect(lengthState(501)).toBe('over');
  });
  it('composePreview giống cách ghép của máy chủ', () => {
    expect(composePreview(' xin chào ', ' công khai ', 'https://a.vn/x')).toBe('xin chào\n\ncông khai\nhttps://a.vn/x');
    expect(composePreview('xin chào', '', null)).toBe('xin chào');
  });
});

describe('hiển thị', () => {
  it('nguồn gốc bài', () => {
    expect(originLabel({ generatedBy: 'HUMAN', llmProvider: null, authorId: 'u' })).toBe('Người soạn');
    expect(originLabel({ generatedBy: 'AI', llmProvider: 'mock', authorId: null })).toBe('AI mẫu (giả lập)');
    expect(originLabel({ generatedBy: 'AI', llmProvider: 'claude', authorId: 'u' })).toBe('AI đề xuất, đã được người chỉnh sửa');
  });
  it('excerpt rút gọn và gộp khoảng trắng', () => {
    expect(excerpt('a   b\n c')).toBe('a b c');
    expect(excerpt('x'.repeat(200), 10)).toBe('xxxxxxxxxx…');
  });
});


describe('catalog', () => {
  const link = (id: string, ok: boolean): LinkItem => ({
    id,
    productId: 'p',
    affiliateUrl: `https://s.shopee.vn/${id}`,
    linkStatus: ok ? 'ACTIVE' : 'UNVERIFIED',
    publishable: ok ? { ok: true } : { ok: false, reason: 'Link chưa được xác minh.' },
  });

  it('mặc định chọn link đăng được trước', () => {
    expect(pickDefaultLink([link('a', false), link('b', true)])).toBe('b');
    expect(pickDefaultLink([link('a', false)])).toBe('a');
    expect(pickDefaultLink([])).toBe('');
  });

  it('nhãn link và media nói rõ khi chưa dùng được', () => {
    expect(linkOptionLabel(link('a', true))).toBe('https://s.shopee.vn/a - đã xác minh');
    expect(linkOptionLabel(link('b', false))).toBe('https://s.shopee.vn/b - chưa xác minh (chưa đăng được)');
    expect(mediaOptionLabel({ id: '1', title: 'Ảnh', mediaType: 'IMAGE', licenseStatus: 'VALID' })).toBe('Ảnh - hợp lệ');
    expect(mediaOptionLabel({ id: '1', title: 'Ảnh', mediaType: 'IMAGE', licenseStatus: 'EXPIRED' })).toBe('Ảnh - hết hạn (chưa dùng được)');
  });

  it('chỉ VALID và EXPIRING_SOON dùng được', () => {
    expect(['VALID', 'EXPIRING_SOON', 'EXPIRED', 'UNLICENSED', 'NEEDS_REVIEW', 'RESTRICTED', 'REJECTED'].map(mediaUsable)).toEqual([
      true, true, false, false, false, false, false,
    ]);
  });
});
