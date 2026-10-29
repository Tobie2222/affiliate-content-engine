import {
  buildMetricPayload,
  canWriteAnalytics,
  commissionLines,
  EMPTY_METRIC_FORM,
  formatMetric,
  hasOrders,
  ordersText,
  rangeQuery,
  reasonsText,
  summarizeConversionImport,
  type OrderStats,
} from './analytics';

const stats = (over: Partial<OrderStats> = {}): OrderStats => ({ pending: 0, completed: 0, cancelled: 0, commissionUnknown: 0, commission: {}, ...over });

describe('quyền', () => {
  it('khớp máy chủ: OWNER, ADMIN, ANALYST được nhập số liệu', () => {
    const roles = ['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'] as const;
    expect(roles.map(canWriteAnalytics)).toEqual([true, true, false, false, true]);
  });
});

describe('chưa biết khác 0', () => {
  it('formatMetric: null/undefined là gạch ngang, 0 vẫn là 0', () => {
    expect(formatMetric(null)).toBe('—');
    expect(formatMetric(undefined)).toBe('—');
    expect(formatMetric(0)).toBe('0');
    expect(formatMetric(1200)).toBe('1.200');
  });

  it('ordersText nói "Chưa có đơn" khi không có đơn', () => {
    expect(ordersText(stats())).toBe('Chưa có đơn');
    expect(hasOrders(stats())).toBe(false);
    expect(ordersText(stats({ completed: 2, pending: 1, cancelled: 3 }))).toBe('2 hoàn tất, 1 chờ, 3 hủy');
    expect(hasOrders(stats({ cancelled: 1 }))).toBe(true);
  });

  it('commissionLines tách từng loại tiền và chỉ nêu phần chờ khi > 0', () => {
    const lines = commissionLines(stats({ commission: { VND: { confirmed: 15000, pending: 5000 }, USD: { confirmed: 3, pending: 0 } } }));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('đã chốt');
    expect(lines[0]).toContain('chờ');
    expect(lines[1]).toContain('đã chốt');
    expect(lines[1]).not.toContain('chờ');
    expect(commissionLines(stats())).toEqual([]);
  });

  it('reasonsText liệt kê số đơn theo từng lý do', () => {
    expect(reasonsText({ NO_SUBID: 2, BEFORE_PUBLISH: 1 })).toEqual([
      '2 đơn: Đơn không có sub_id nên không biết thuộc bài nào',
      '1 đơn: Đơn phát sinh trước khi bài được đăng',
    ]);
  });
});

describe('buildMetricPayload', () => {
  it('ô trống không được gửi (chưa biết); số 0 được gửi', () => {
    expect(buildMetricPayload({ ...EMPTY_METRIC_FORM, views: '120', likes: '0' })).toEqual({ ok: true, payload: { views: 120, likes: 0 } });
  });

  it('yêu cầu ít nhất một số', () => {
    const r = buildMetricPayload(EMPTY_METRIC_FORM);
    expect(r.ok).toBe(false);
  });

  it('từ chối số thập phân, dấu phân cách nghìn, số âm, quá lớn', () => {
    for (const bad of ['1.200', '1,200', '-5', '1.5', '12a', '2000000000']) {
      expect(buildMetricPayload({ ...EMPTY_METRIC_FORM, views: bad }).ok).toBe(false);
    }
  });

  it('cắt khoảng trắng', () => {
    expect(buildMetricPayload({ ...EMPTY_METRIC_FORM, replies: ' 4 ' })).toEqual({ ok: true, payload: { replies: 4 } });
  });
});

describe('khoảng thời gian và tóm tắt nhập', () => {
  it('rangeQuery tạo from/to ISO đã mã hóa, rộng đúng số ngày', () => {
    const now = new Date('2026-10-29T08:00:00Z');
    const q = rangeQuery(7, now);
    const params = new URLSearchParams(q);
    const from = new Date(params.get('from') as string);
    const to = new Date(params.get('to') as string);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(7);
    expect(to.getTime()).toBeGreaterThan(now.getTime());
  });

  it('summarizeConversionImport phân biệt kiểm tra thử và ghi thật', () => {
    const base = { totalRows: 3, valid: 2, invalid: 1, created: 1, updated: 1, unchanged: 0, errors: [], ignoredColumns: [] };
    expect(summarizeConversionImport({ ...base, dryRun: true })).toContain('Chưa ghi gì');
    expect(summarizeConversionImport({ ...base, dryRun: false })).toBe('Xử lý 3 dòng: thêm mới 1, cập nhật 1, không đổi 0, lỗi 1.');
  });
});
