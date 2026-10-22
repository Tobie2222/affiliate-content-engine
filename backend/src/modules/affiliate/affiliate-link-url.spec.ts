import { validateUserAffiliateUrl } from './affiliate-link-url';

describe('validateUserAffiliateUrl', () => {
  it('chấp nhận link rút gọn Shopee qua https', () => {
    for (const u of ['https://s.shopee.vn/AbCdEf', 'https://shope.ee/xyz', 'https://shp.ee/q1']) {
      expect(validateUserAffiliateUrl(u).ok).toBe(true);
    }
  });

  it('chuẩn hóa tên miền chữ hoa', () => {
    const r = validateUserAffiliateUrl('https://S.SHOPEE.VN/AbC');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe('https://s.shopee.vn/AbC');
  });

  it('từ chối tên miền không nằm trong danh sách, kể cả tên gần giống', () => {
    const bad = [
      'https://evil.example.com/shopee',
      'https://shopee.vn.evil.com/x',
      'https://s-shopee.vn/x',
      'https://xshopee.vn/x',
      'https://shopee.vn@evil.com/x',
    ];
    for (const u of bad) {
      expect(validateUserAffiliateUrl(u).ok).toBe(false);
    }
  });

  it('từ chối http, IP, cổng lạ và URL sai cú pháp', () => {
    for (const u of ['http://s.shopee.vn/a', 'https://127.0.0.1/a', 'https://s.shopee.vn:8443/a', 'abc', '']) {
      expect(validateUserAffiliateUrl(u).ok).toBe(false);
    }
  });
});
