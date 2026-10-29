import {
  accountLabel,
  activeAccounts,
  canManageAccounts,
  canSchedulePosts,
  defaultScheduleInput,
  failureText,
  localInputToIso,
  publishActions,
  toLocalInput,
  validateScheduleInput,
  type PublishJob,
  type SocialAccount,
} from './publishing';

const NOW = new Date('2026-10-29T01:00:00Z'); // 08:00 giờ Việt Nam

function job(over: Partial<PublishJob> = {}): PublishJob {
  return {
    id: 'j1', socialAccountId: 'a1', contentVersion: 1, scheduledFor: NOW.toISOString(), status: 'FAILED', attempts: 1,
    failureKind: 'UNKNOWN', retrySafe: false, lastError: null, createdAt: NOW.toISOString(), ...over,
  };
}

describe('quyền', () => {
  it('khớp máy chủ', () => {
    const roles = ['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'] as const;
    expect(roles.map(canSchedulePosts)).toEqual([true, true, true, false, false]);
    expect(roles.map(canManageAccounts)).toEqual([true, true, false, false, false]);
  });
});

describe('giờ Việt Nam', () => {
  it('đổi giờ nhập (UTC+7) sang ISO UTC', () => {
    expect(localInputToIso('2026-10-30T09:00')).toBe('2026-10-30T02:00:00.000Z');
    expect(localInputToIso('2026-10-30T05:30')).toBe('2026-10-29T22:30:00.000Z');
  });

  it('từ chối giá trị sai định dạng hoặc ngày không tồn tại', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-10-30')).toBeNull();
    expect(localInputToIso('2026-02-31T10:00')).toBeNull();
    expect(localInputToIso('2026-10-30T25:00')).toBeNull();
  });

  it('toLocalInput và localInputToIso là nghịch đảo', () => {
    const value = toLocalInput(NOW);
    expect(value).toBe('2026-10-29T08:00');
    expect(localInputToIso(value)).toBe(NOW.toISOString());
  });

  it('gợi ý mặc định: sau 30 phút, làm tròn lên 5 phút', () => {
    expect(defaultScheduleInput(NOW)).toBe('2026-10-29T08:30');
    expect(defaultScheduleInput(new Date(NOW.getTime() + 60_000))).toBe('2026-10-29T08:35');
  });
});

describe('validateScheduleInput', () => {
  it('bắt buộc chọn tài khoản và giờ hợp lệ', () => {
    expect(validateScheduleInput('2026-10-30T09:00', '', NOW)).toContain('tài khoản');
    expect(validateScheduleInput('xx', 'a1', NOW)).toContain('hợp lệ');
  });

  it('giờ đăng phải sau hiện tại ít nhất 2 phút', () => {
    expect(validateScheduleInput('2026-10-29T08:01', 'a1', NOW)).toContain('ít nhất 2 phút');
    expect(validateScheduleInput('2026-10-29T07:00', 'a1', NOW)).toContain('ít nhất 2 phút');
    expect(validateScheduleInput('2026-10-29T08:02', 'a1', NOW)).toBeNull();
  });

  it('tối đa 60 ngày', () => {
    expect(validateScheduleInput('2026-12-29T08:00', 'a1', NOW)).toContain('60 ngày');
    expect(validateScheduleInput('2026-12-27T08:00', 'a1', NOW)).toBeNull();
  });
});

describe('publishActions', () => {
  it('chỉ người có quyền mới lên lịch bài đã duyệt', () => {
    expect(publishActions('APPROVED', [], 'CONTENT_EDITOR').canSchedule).toBe(true);
    expect(publishActions('APPROVED', [], 'REVIEWER').canSchedule).toBe(false);
    expect(publishActions('DRAFT', [], 'OWNER').canSchedule).toBe(false);
  });

  it('hủy lịch chỉ khi đang SCHEDULED', () => {
    expect(publishActions('SCHEDULED', [], 'ADMIN').canUnschedule).toBe(true);
    expect(publishActions('PUBLISHING', [], 'ADMIN').canUnschedule).toBe(false);
  });

  it('lỗi không rõ: cần xác nhận; lỗi chắc chắn chưa gửi: không cần', () => {
    expect(publishActions('FAILED', [job()], 'OWNER')).toMatchObject({ canRetry: true, retryNeedsConfirm: true });
    expect(publishActions('FAILED', [job({ failureKind: 'NOT_SENT', retrySafe: true })], 'OWNER')).toMatchObject({
      canRetry: true,
      retryNeedsConfirm: false,
    });
  });

  it('không có lần thất bại nào thì không thử lại được', () => {
    expect(publishActions('FAILED', [], 'OWNER').canRetry).toBe(false);
    expect(publishActions('FAILED', [job()], 'ANALYST').canRetry).toBe(false);
  });

  it('lấy lần thất bại mới nhất (đứng đầu danh sách)', () => {
    const jobs = [job({ id: 'new', failureKind: 'NOT_SENT', retrySafe: true }), job({ id: 'old' })];
    expect(publishActions('FAILED', jobs, 'OWNER').retryNeedsConfirm).toBe(false);
  });
});

describe('hiển thị', () => {
  it('failureText nói rõ có thử lại an toàn không', () => {
    expect(failureText({ failureKind: 'NOT_SENT', lastError: 'Vượt hạn mức.' })).toContain('an toàn');
    expect(failureText({ failureKind: 'UNKNOWN', lastError: null })).toContain('kiểm tra trực tiếp');
  });

  it('nhãn tài khoản đánh dấu giả lập; chỉ lấy tài khoản đang hoạt động', () => {
    const base = { id: 'x', createdAt: '', displayName: 'Shop' };
    const accounts: SocialAccount[] = [
      { ...base, id: '1', handle: 'a', mode: 'MOCK', status: 'ACTIVE' },
      { ...base, id: '2', handle: 'b', mode: 'MOCK', status: 'DISCONNECTED' },
    ];
    expect(accountLabel(accounts[0])).toBe('@a (Shop) - giả lập');
    expect(activeAccounts(accounts).map((a) => a.id)).toEqual(['1']);
  });
});
