import {
  ApiLink,
  EMPTY_PRODUCT_FORM,
  buildProductPayload,
  canVerifyLinks,
  canWriteCatalog,
  formatCommission,
  formatPrice,
  linkActions,
  parseDecimal,
  priceFreshness,
  scoreTone,
  summarizeBulk,
  validateProductForm,
} from './products';

const NOW = new Date('2026-10-28T03:00:00Z');
const DAY = 86_400_000;
const valid = { ...EMPTY_PRODUCT_FORM, externalProductId: 'SP1', name: 'Bình', productUrl: 'https://shopee.vn/p/1' };

describe('parseDecimal', () => {
  it('nhận số nguyên và tối đa 2 chữ số thập phân', () => {
    expect(parseDecimal('189000')).toBe(189000);
    expect(parseDecimal(' 7.5 ')).toBe(7.5);
    expect(parseDecimal('7,25')).toBe(7.25);
    expect(parseDecimal('0')).toBe(0);
  });
  it('từ chối dấu phân cách hàng nghìn thay vì hiểu nhầm', () => {
    expect(parseDecimal('189.000')).toBe(null);
    expect(parseDecimal('189,000')).toBe(null);
    expect(parseDecimal('1.890.000')).toBe(null);
  });
  it('từ chối rỗng, chữ, số âm', () => {
    expect(parseDecimal('')).toBe(null);
    expect(parseDecimal('abc')).toBe(null);
    expect(parseDecimal('-5')).toBe(null);
  });
});

describe('validateProductForm', () => {
  it('form tối thiểu hợp lệ (giá và hoa hồng để trống = chưa biết)', () => {
    expect(validateProductForm(valid)).toEqual({});
  });
  it('thiếu trường bắt buộc và link sai', () => {
    const e = validateProductForm({ ...EMPTY_PRODUCT_FORM, productUrl: 'shopee.vn/x' });
    expect(Object.keys(e).sort()).toEqual(['externalProductId', 'name', 'productUrl']);
  });
  it('có giá thì cần tiền tệ; giá sai định dạng bị báo', () => {
    expect(validateProductForm({ ...valid, price: '189000', currency: '' }).currency).toBeDefined();
    expect(validateProductForm({ ...valid, price: '189.000' }).price).toBeDefined();
  });
  it('hoa hồng 0-100', () => {
    expect(validateProductForm({ ...valid, commissionRate: '101' }).commissionRate).toBeDefined();
    expect(validateProductForm({ ...valid, commissionRate: '0' })).toEqual({});
  });
});

describe('buildProductPayload', () => {
  it('ô trống không được gửi (không biến thành 0)', () => {
    expect(buildProductPayload(valid)).toEqual({ externalProductId: 'SP1', name: 'Bình', productUrl: 'https://shopee.vn/p/1' });
  });
  it('gửi giá kèm tiền tệ viết hoa và hoa hồng khi có', () => {
    const p = buildProductPayload({ ...valid, price: '189000', currency: 'vnd', commissionRate: '8', category: ' Gia dụng ' });
    expect(p).toMatchObject({ price: 189000, currency: 'VND', commissionRate: 8, category: 'Gia dụng' });
  });
  it('hoa hồng 0 là giá trị thật và vẫn được gửi', () => {
    expect(buildProductPayload({ ...valid, commissionRate: '0' }).commissionRate).toBe(0);
  });
});

describe('hiển thị giá và hoa hồng', () => {
  it('chưa biết khác 0', () => {
    expect(formatPrice(null, null)).toBe('Chưa biết giá');
    expect(formatPrice(0, 'VND')).toBe('0 đ');
    expect(formatCommission(null)).toBe('Chưa biết');
    expect(formatCommission(0)).toBe('0%');
  });
  it('độ mới của giá', () => {
    expect(priceFreshness(null, null, NOW)).toBe('unknown');
    expect(priceFreshness(100, null, NOW)).toBe('unknown');
    expect(priceFreshness(100, new Date(NOW.getTime() - 3 * DAY).toISOString(), NOW)).toBe('fresh');
    expect(priceFreshness(100, new Date(NOW.getTime() - 8 * DAY).toISOString(), NOW)).toBe('stale');
  });
});

describe('quyền và thao tác link', () => {
  const link = (linkStatus: ApiLink['linkStatus']) => ({ linkStatus });
  it('quyền theo vai trò khớp backend', () => {
    expect((['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'] as const).map(canWriteCatalog)).toEqual([true, true, true, false, false]);
    expect((['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'] as const).map(canVerifyLinks)).toEqual([true, true, false, true, false]);
  });
  it('xác minh chỉ cho link chưa xác minh, và chỉ người có quyền', () => {
    expect(linkActions(link('UNVERIFIED'), 'REVIEWER')).toEqual({ canVerify: true, canRevoke: false });
    expect(linkActions(link('UNVERIFIED'), 'CONTENT_EDITOR')).toEqual({ canVerify: false, canRevoke: true });
    expect(linkActions(link('ACTIVE'), 'OWNER')).toEqual({ canVerify: false, canRevoke: true });
    expect(linkActions(link('REVOKED'), 'OWNER')).toEqual({ canVerify: false, canRevoke: false });
  });
});

describe('tóm tắt nhập', () => {
  const base = { totalRows: 5, valid: 4, invalid: 1, created: 3, updated: 1, errors: [] };
  it('chạy thử không ghi gì', () => {
    expect(summarizeBulk({ ...base, dryRun: true })).toBe('Kiểm tra 5 dòng: 4 hợp lệ, 1 lỗi. Chưa ghi gì vào hệ thống.');
  });
  it('nhập thật', () => {
    expect(summarizeBulk({ ...base, dryRun: false })).toBe('Xử lý 5 dòng: thêm mới 3, cập nhật 1, lỗi 1.');
  });
  it('màu điểm', () => {
    expect([80, 50, 10].map(scoreTone)).toEqual(['good', 'wait', 'bad']);
  });
});
