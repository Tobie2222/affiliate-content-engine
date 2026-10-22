import { validateUserAffiliateUrl } from './affiliate-link-url';
import { normalizeProductRow } from './product-normalizer';
import { MockShopeeProvider } from './providers/mock-shopee.provider';
import { parsePublicHttpsUrl } from './url-policy';

describe('MockShopeeProvider', () => {
  const provider = new MockShopeeProvider();

  it('tự khai báo là mock', () => {
    expect(provider.mode).toBe('mock');
  });

  it('mọi sản phẩm giả đều có tiền tố [MOCK] và dùng tên miền .invalid', async () => {
    const rows = await provider.fetchProducts(100);
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.name.startsWith('[MOCK]')).toBe(true);
      expect(row.product_url.includes('.invalid/')).toBe(true);
    }
  });

  it('mọi dòng giả vượt qua bộ kiểm tra chuẩn hóa như dữ liệu thật', async () => {
    const rows = await provider.fetchProducts(100);
    for (const row of rows) {
      expect(normalizeProductRow(row).ok).toBe(true);
    }
  });

  it('có cả dữ liệu chưa biết (null) lẫn giá trị 0 thật để thử luồng', async () => {
    const rows = await provider.fetchProducts(100);
    const byId = new Map(rows.map((r) => [r.external_product_id, normalizeProductRow(r)]));
    const unknownCommission = byId.get('MOCK-002');
    const unknownPrice = byId.get('MOCK-003');
    const zeros = byId.get('MOCK-004');
    if (!unknownCommission?.ok || !unknownPrice?.ok || !zeros?.ok) throw new Error('dòng giả không hợp lệ');
    expect(unknownCommission.value.commissionRate).toBe(null);
    expect(unknownPrice.value.currentPrice).toBe(null);
    expect(zeros.value.currentPrice).toBe(0);
    expect(zeros.value.commissionRate).toBe(0);
  });

  it('giới hạn số dòng trả về và trả bản sao (sửa kết quả không làm hỏng dữ liệu gốc)', async () => {
    const two = await provider.fetchProducts(2);
    expect(two.length).toBe(2);
    two[0].name = 'đã bị sửa';
    const again = await provider.fetchProducts(1);
    expect(again[0].name.startsWith('[MOCK]')).toBe(true);
    expect((await provider.fetchProducts(0)).length).toBe(0);
  });

  it('link giả dùng tên miền .invalid, mỗi lần một mã khác nhau, gắn subId', async () => {
    const a = await provider.generateShortLink({ productUrl: 'https://x.invalid/p', subIds: ['camp1'] });
    const b = await provider.generateShortLink({ productUrl: 'https://x.invalid/p', subIds: [] });
    expect(a.affiliateUrl.startsWith('https://mock-affiliate.invalid/s/')).toBe(true);
    expect(a.affiliateUrl.includes('sub=camp1')).toBe(true);
    expect(a.affiliateUrl === b.affiliateUrl).toBe(false);
    expect(a.externalLinkId?.startsWith('mock-')).toBe(true);
    expect(parsePublicHttpsUrl(a.affiliateUrl).ok).toBe(true);
  });

  it('link giả KHÔNG thể được nhập như link người dùng tự có (không lẫn với link thật)', async () => {
    const link = await provider.generateShortLink({ productUrl: 'https://x.invalid/p', subIds: [] });
    expect(validateUserAffiliateUrl(link.affiliateUrl).ok).toBe(false);
  });
});
