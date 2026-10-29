import {
  buildReport,
  normalizeConversionRow,
  parseOrderTime,
  validateMetricInput,
  type ReportConversion,
  type ReportLink,
  type ReportMetric,
  type ReportPost,
} from './analytics-rules';

const NOW = new Date('2026-10-29T08:00:00Z');

describe('parseOrderTime', () => {
  it('ngày không giờ và giờ không múi giờ được hiểu là giờ Việt Nam', () => {
    expect(parseOrderTime('2026-10-27')?.toISOString()).toBe('2026-10-26T17:00:00.000Z');
    expect(parseOrderTime('2026-10-27 14:30')?.toISOString()).toBe('2026-10-27T07:30:00.000Z');
    expect(parseOrderTime('2026-10-27T14:30:05')?.toISOString()).toBe('2026-10-27T07:30:05.000Z');
  });

  it('ISO có múi giờ giữ nguyên thời điểm', () => {
    expect(parseOrderTime('2026-10-27T07:30:00Z')?.toISOString()).toBe('2026-10-27T07:30:00.000Z');
    expect(parseOrderTime('2026-10-27T14:30:00+07:00')?.toISOString()).toBe('2026-10-27T07:30:00.000Z');
  });

  it('không đoán dạng khác hoặc ngày không tồn tại', () => {
    for (const bad of ['27/10/2026', '10/27/2026', '2026-02-31', '2026-10-27 25:00', 'hôm qua', '']) {
      expect(parseOrderTime(bad)).toBeNull();
    }
  });
});

describe('normalizeConversionRow', () => {
  const base = { order_id: 'O1', product_id: 'SP001', order_time: '2026-10-27', status: 'Completed' };

  it('dòng hợp lệ tối thiểu: hoa hồng và sub_id là chưa biết (null), không phải 0', () => {
    const r = normalizeConversionRow(base, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ externalOrderId: 'O1', externalProductId: 'SP001', status: 'COMPLETED', commissionAmount: null, currency: null, subId: null });
    }
  });

  it('chấp nhận canceled/cancelled không phân biệt hoa thường', () => {
    for (const status of ['canceled', 'CANCELLED', 'Pending']) {
      expect(normalizeConversionRow({ ...base, status }, NOW).ok).toBe(true);
    }
  });

  it('từ chối trạng thái lạ thay vì đoán', () => {
    const r = normalizeConversionRow({ ...base, status: 'Đã hoàn thành' }, NOW);
    expect(r).toEqual({ ok: false, errors: ['status phải là pending, completed hoặc cancelled.'] });
  });

  it('hoa hồng: số thuần, cần currency, không nhận dấu phân cách hàng nghìn', () => {
    expect(normalizeConversionRow({ ...base, commission: '15000.5', currency: 'vnd' }, NOW)).toMatchObject({ ok: true, value: { commissionAmount: 15000.5, currency: 'VND' } });
    expect(normalizeConversionRow({ ...base, commission: '15000' }, NOW).ok).toBe(false);
    expect(normalizeConversionRow({ ...base, commission: '15.000,5', currency: 'VND' }, NOW).ok).toBe(false);
    expect(normalizeConversionRow({ ...base, commission: '15.000', currency: 'VND' }, NOW).ok).toBe(false);
    expect(normalizeConversionRow({ ...base, commission: '-5', currency: 'VND' }, NOW).ok).toBe(false);
  });

  it('thiếu trường bắt buộc, thời gian ở tương lai, sub_id sai ký tự', () => {
    const r = normalizeConversionRow({ order_id: '', product_id: '', order_time: '', status: '' }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBe(4);
    }
    expect(normalizeConversionRow({ ...base, order_time: '2026-12-01' }, NOW).ok).toBe(false);
    expect(normalizeConversionRow({ ...base, sub_id: 'có dấu' }, NOW).ok).toBe(false);
  });
});

describe('validateMetricInput', () => {
  it('cần ít nhất một số liệu; trường bỏ trống là null', () => {
    expect(validateMetricInput({})).toEqual({ ok: false, reason: 'Hãy nhập ít nhất một số liệu.' });
    const r = validateMetricInput({ views: 120, likes: 0 });
    expect(r).toEqual({ ok: true, values: { views: 120, likes: 0, replies: null, reposts: null, quotes: null } });
  });

  it('từ chối số âm, số thập phân', () => {
    expect(validateMetricInput({ views: -1 }).ok).toBe(false);
    expect(validateMetricInput({ views: 1.5 }).ok).toBe(false);
  });
});

// ---------- Báo cáo ----------

const D = (iso: string) => new Date(iso);
const FROM = D('2026-10-01T00:00:00Z');
const TO = D('2026-11-01T00:00:00Z');
const post = (id: string, link: string, publishedAt = '2026-10-10T00:00:00Z'): ReportPost => ({
  publishedPostId: id, contentPostId: `c-${id}`, productId: 'prod1', affiliateLinkId: link, socialAccountId: 'a1', publishedAt: D(publishedAt),
});
const link = (id: string, subId: string | null): ReportLink => ({ id, productId: 'prod1', subId });
const conv = (over: Partial<ReportConversion> = {}): ReportConversion => ({
  externalOrderId: 'O1', externalProductId: 'SP001', orderTime: D('2026-10-12T00:00:00Z'), status: 'COMPLETED',
  commissionAmount: 10000, currency: 'VND', subId: 's1', ...over,
});
const metric = (id: string, at: string, over: Partial<ReportMetric> = {}): ReportMetric => ({
  publishedPostId: id, capturedAt: D(at), views: null, likes: null, replies: null, reposts: null, quotes: null, source: 'MANUAL', ...over,
});
const products = [{ id: 'prod1', externalProductId: 'SP001', name: 'Bình giữ nhiệt' }];
const run = (over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({ posts: [post('P1', 'L1')], metrics: [], conversions: [], links: [link('L1', 's1')], products, from: FROM, to: TO, ...over });

describe('buildReport: gắn đơn vào bài', () => {
  it('sub_id khớp đúng một link dùng trong đúng một bài đã đăng sau thời điểm đăng -> gắn vào bài', () => {
    const r = run({ conversions: [conv(), conv({ externalOrderId: 'O2', status: 'PENDING', commissionAmount: 5000 }), conv({ externalOrderId: 'O3', status: 'CANCELLED' })] });
    expect(r.posts[0].orders).toMatchObject({ completed: 1, pending: 1, cancelled: 1, commissionUnknown: 0, commission: { VND: { confirmed: 10000, pending: 5000 } } });
    expect(r.totals.attributed.completed).toBe(1);
    expect(r.unattributed).toEqual([]);
  });

  it('không có sub_id -> chưa gắn được, gom theo sản phẩm kèm lý do', () => {
    const r = run({ conversions: [conv({ subId: null }), conv({ externalOrderId: 'O2', subId: null })] });
    expect(r.posts[0].orders.completed).toBe(0);
    expect(r.unattributed).toHaveLength(1);
    expect(r.unattributed[0]).toMatchObject({ productKey: 'SP001', productName: 'Bình giữ nhiệt', reasons: { NO_SUBID: 2 } });
    expect(r.totals.unattributed.completed).toBe(2);
  });

  it('sub_id lạ, trùng nhiều link, link không có bài, link nhiều bài, đơn trước giờ đăng', () => {
    const cases: Array<[Partial<Parameters<typeof buildReport>[0]>, ReportConversion, string]> = [
      [{}, conv({ subId: 'zzz' }), 'SUBID_UNKNOWN'],
      [{ links: [link('L1', 's1'), link('L2', 's1')] }, conv(), 'SUBID_AMBIGUOUS_LINK'],
      [{ posts: [] }, conv(), 'LINK_NO_PUBLISHED_POST'],
      [{ posts: [post('P1', 'L1'), post('P2', 'L1')] }, conv(), 'LINK_MULTIPLE_POSTS'],
      [{}, conv({ orderTime: D('2026-10-09T00:00:00Z') }), 'BEFORE_PUBLISH'],
    ];
    for (const [over, c, reason] of cases) {
      const r = run({ ...over, conversions: [c] });
      expect(r.unattributed[0].reasons).toEqual({ [reason]: 1 });
      expect(r.totals.attributed.completed).toBe(0);
    }
  });

  it('hoa hồng chưa biết được đếm riêng, không cộng như 0', () => {
    const r = run({ conversions: [conv({ commissionAmount: null, currency: null })] });
    expect(r.posts[0].orders.commissionUnknown).toBe(1);
    expect(r.posts[0].orders.commission).toEqual({});
  });

  it('không cộng lẫn các loại tiền và không sai số dấu phẩy động', () => {
    const r = run({ conversions: [
      conv({ externalOrderId: 'A', commissionAmount: 0.1 }),
      conv({ externalOrderId: 'B', commissionAmount: 0.2 }),
      conv({ externalOrderId: 'C', commissionAmount: 3, currency: 'USD' }),
    ] });
    expect(r.posts[0].orders.commission).toEqual({ VND: { confirmed: 0.3, pending: 0 }, USD: { confirmed: 3, pending: 0 } });
  });

  it('đơn ngoài khoảng thời gian bị bỏ qua', () => {
    const r = run({ conversions: [conv({ orderTime: D('2026-09-30T00:00:00Z') }), conv({ externalOrderId: 'O9', orderTime: D('2026-11-01T00:00:00Z') })] });
    expect(r.totals.attributed.completed).toBe(0);
    expect(r.totals.unattributed.completed).toBe(0);
  });
});

describe('buildReport: số liệu bài', () => {
  it('lấy ảnh chụp mới nhất; trường chưa biết giữ null', () => {
    const r = run({ metrics: [metric('P1', '2026-10-11T00:00:00Z', { views: 100 }), metric('P1', '2026-10-13T00:00:00Z', { views: 250, likes: null })] });
    expect(r.posts[0].metrics).toMatchObject({ views: 250, likes: null });
  });

  it('bài chưa nhập số liệu: metrics null và không tính vào tổng lượt xem như 0', () => {
    const r = run({ posts: [post('P1', 'L1'), post('P2', 'L2', '2026-10-11T00:00:00Z')], metrics: [metric('P1', '2026-10-12T00:00:00Z', { views: 100 })] });
    expect(r.totals.views).toEqual({ total: 100, knownPosts: 1 });
    expect(r.totals.postsWithMetrics).toBe(1);
    expect(r.posts.find((p) => p.publishedPostId === 'P2')?.metrics).toBeNull();
  });

  it('bài có số liệu nhưng views chưa biết thì không tính vào knownPosts', () => {
    const r = run({ metrics: [metric('P1', '2026-10-12T00:00:00Z', { likes: 3 })] });
    expect(r.totals.views).toEqual({ total: 0, knownPosts: 0 });
    expect(r.totals.postsWithMetrics).toBe(1);
  });
});

describe('buildReport: danh sách bài', () => {
  it('chỉ liệt kê bài đăng trong khoảng hoặc có đơn gắn trong khoảng; mới nhất trước', () => {
    const old = post('OLD', 'L9', '2026-09-01T00:00:00Z');
    const oldWithOrder = post('OLD2', 'L2', '2026-09-02T00:00:00Z');
    const r = run({
      posts: [old, oldWithOrder, post('P1', 'L1', '2026-10-05T00:00:00Z'), post('P3', 'L3', '2026-10-20T00:00:00Z')],
      links: [link('L1', 's1'), link('L2', 's2')],
      conversions: [conv({ subId: 's2' })],
    });
    expect(r.posts.map((p) => p.publishedPostId)).toEqual(['P3', 'P1', 'OLD2']);
  });
});
