import {
  EMPTY_ASSET_FORM,
  EMPTY_LICENSE_FORM,
  buildAssetPayload,
  buildLicensePayload,
  canReviewMedia,
  canWriteMedia,
  daysLeft,
  listExpiryText,
  validityText,
  endOfDayVN,
  expiryText,
  licenseNeeds,
  summarizeRecheck,
  validateAssetForm,
  validateLicenseForm,
  validateLicenseReview,
} from './media';

const NOW = new Date('2026-10-28T03:00:00Z'); // 10:00 giờ Việt Nam
const ROLES = ['OWNER', 'ADMIN', 'CONTENT_EDITOR', 'REVIEWER', 'ANALYST'] as const;

describe('quyền', () => {
  it('khớp backend', () => {
    expect(ROLES.map(canWriteMedia)).toEqual([true, true, true, false, false]);
    expect(ROLES.map(canReviewMedia)).toEqual([true, true, false, true, false]);
  });
});

describe('form media', () => {
  it('cần tên và địa chỉ https', () => {
    expect(Object.keys(validateAssetForm(EMPTY_ASSET_FORM)).sort()).toEqual(['sourceUrl', 'title']);
    expect(validateAssetForm({ ...EMPTY_ASSET_FORM, title: 'Ảnh', sourceUrl: 'http://a.vn/x.jpg' }).sourceUrl).toBeDefined();
    expect(validateAssetForm({ ...EMPTY_ASSET_FORM, title: 'Ảnh', sourceUrl: 'https://a.vn/x.jpg' })).toEqual({});
  });
  it('payload bỏ mô tả trống', () => {
    expect(buildAssetPayload({ ...EMPTY_ASSET_FORM, title: ' Ảnh ', sourceUrl: ' https://a.vn/x.jpg ' })).toEqual({
      mediaType: 'IMAGE',
      title: 'Ảnh',
      sourceUrl: 'https://a.vn/x.jpg',
    });
  });
});

describe('yêu cầu theo loại giấy phép (khớp máy chủ)', () => {
  const f = (over: Partial<typeof EMPTY_LICENSE_FORM>) => ({ ...EMPTY_LICENSE_FORM, ...over });

  it('tự sở hữu: cần mô tả >= 10 ký tự', () => {
    expect(validateLicenseForm(f({ licenseType: 'OWNED', proofNote: 'ngắn' }), NOW).proofNote).toBeDefined();
    expect(validateLicenseForm(f({ licenseType: 'OWNED', proofNote: 'Ảnh tự chụp tại cửa hàng ngày 20/10' }), NOW)).toEqual({});
  });

  it('CC0: cần link nguồn', () => {
    expect(validateLicenseForm(f({ licenseType: 'CC0' }), NOW).proofUrl).toBeDefined();
    expect(validateLicenseForm(f({ licenseType: 'CC0', proofUrl: 'https://creativecommons.org/x' }), NOW)).toEqual({});
  });

  it('CC BY: cần link, tên tác giả và dòng ghi nguồn', () => {
    const e = validateLicenseForm(f({ licenseType: 'CC_BY' }), NOW);
    expect(Object.keys(e).sort()).toEqual(['attributionText', 'licensorName', 'proofUrl']);
  });

  it('mua/đối tác: cần tên bên cấp phép và link HOẶC ghi chú', () => {
    const e = validateLicenseForm(f({ licenseType: 'COMMERCIAL_PURCHASED' }), NOW);
    expect(Object.keys(e).sort()).toEqual(['licensorName', 'proofNote']);
    expect(validateLicenseForm(f({ licenseType: 'PARTNER_GRANTED', licensorName: 'Shop A', proofNote: 'HD-123' }), NOW)).toEqual({});
    expect(validateLicenseForm(f({ licenseType: 'PARTNER_GRANTED', licensorName: 'Shop A', proofUrl: 'https://a.vn/p' }), NOW)).toEqual({});
  });

  it('link bằng chứng phải https', () => {
    expect(validateLicenseForm(f({ licenseType: 'CC0', proofUrl: 'http://a.vn' }), NOW).proofUrl).toBeDefined();
  });

  it('licenseNeeds khớp các quy tắc trên', () => {
    expect(licenseNeeds('CC_BY')).toEqual({ licensorName: 'required', proofUrl: 'required', proofNote: 'optional', attributionText: 'required' });
    expect(licenseNeeds('OWNED').proofNote).toBe('required');
  });
});

describe('ngày hiệu lực (giờ Việt Nam)', () => {
  const base = { ...EMPTY_LICENSE_FORM, licenseType: 'OWNED' as const, proofNote: 'Ảnh tự chụp tại cửa hàng ngày 20/10' };

  it('ngày hết hạn là hôm nay (giờ VN) vẫn hợp lệ vì tính đến hết ngày', () => {
    expect(validateLicenseForm({ ...base, validUntil: '2026-10-28' }, NOW)).toEqual({});
  });
  it('ngày hết hạn là hôm qua bị từ chối', () => {
    expect(validateLicenseForm({ ...base, validUntil: '2026-10-27' }, NOW).validUntil).toBeDefined();
  });
  it('hết hạn phải sau ngày bắt đầu; ngày sai bị báo', () => {
    expect(validateLicenseForm({ ...base, validFrom: '2026-11-10', validUntil: '2026-11-01' }, NOW).validUntil).toBeDefined();
    expect(validateLicenseForm({ ...base, validUntil: '2026-02-30' }, NOW).validUntil).toBeDefined();
  });
  it('endOfDayVN: cuối ngày 28/10 giờ VN là 16:59:59.999 UTC cùng ngày', () => {
    expect(new Date(endOfDayVN('2026-10-28') as number).toISOString()).toBe('2026-10-28T16:59:59.999Z');
    expect(endOfDayVN('28/10/2026')).toBe(null);
  });
});

describe('payload giấy phép', () => {
  it('bỏ ô trống, giữ cờ thương mại', () => {
    expect(buildLicensePayload({ ...EMPTY_LICENSE_FORM, proofNote: ' Ảnh tự chụp ', commercialUseAllowed: false })).toEqual({
      licenseType: 'OWNED',
      commercialUseAllowed: false,
      proofNote: 'Ảnh tự chụp',
    });
  });
});

describe('hiển thị hạn', () => {
  it('số ngày còn lại và chữ hiển thị', () => {
    expect(daysLeft(null, NOW)).toBe(null);
    expect(expiryText(null, NOW)).toBe('Không hết hạn');
    expect(expiryText('2026-11-07T03:00:00Z', NOW)).toBe('Còn 10 ngày');
    expect(expiryText('2026-10-28T10:00:00Z', NOW)).toBe('Hết hạn trong hôm nay');
    expect(expiryText('2026-10-20T03:00:00Z', NOW)).toBe('Đã hết hạn');
  });
});

describe('duyệt giấy phép và tóm tắt', () => {
  it('từ chối cần lý do', () => {
    expect(validateLicenseReview('REJECT', 'x')).not.toBe(null);
    expect(validateLicenseReview('REJECT', 'Ảnh lấy từ trang khác')).toBe(null);
    expect(validateLicenseReview('APPROVE', '')).toBe(null);
  });
  it('tóm tắt kiểm tra lại', () => {
    expect(summarizeRecheck({ checked: 5, changed: 1, expiringSoon: 2, changes: [], truncated: false })).toBe('Đã kiểm tra 5 media, 1 thay đổi trạng thái, 2 sắp hết hạn.');
    expect(summarizeRecheck({ checked: 5, changed: 0, expiringSoon: 0, changes: [], truncated: true })).toBe('Đã kiểm tra 5 media, 0 thay đổi trạng thái. Danh sách quá dài nên chỉ kiểm tra một phần.');
  });
});

describe('validityText và listExpiryText', () => {
  it('mô tả khoảng hiệu lực theo giờ Việt Nam', () => {
    expect(validityText(null, null)).toBe('Không giới hạn thời gian');
    expect(validityText(null, '2026-11-02T16:59:59.999Z')).toBe('Đến hết ngày 02/11/2026');
    expect(validityText('2026-10-27T17:00:00Z', null)).toBe('Từ ngày 28/10/2026, không hết hạn');
    expect(validityText('2026-10-27T17:00:00Z', '2026-11-02T16:59:59.999Z')).toBe('Từ ngày 28/10/2026 đến hết ngày 02/11/2026');
  });
  it('danh sách không suy ra "không hết hạn" cho media chưa dùng được', () => {
    expect(listExpiryText({ licenseStatus: 'EXPIRED', licenseExpiresAt: null }, NOW)).toBe(null);
    expect(listExpiryText({ licenseStatus: 'UNLICENSED', licenseExpiresAt: null }, NOW)).toBe(null);
    expect(listExpiryText({ licenseStatus: 'VALID', licenseExpiresAt: null }, NOW)).toBe('Không hết hạn');
    expect(listExpiryText({ licenseStatus: 'EXPIRING_SOON', licenseExpiresAt: '2026-11-07T03:00:00Z' }, NOW)).toBe('Còn 10 ngày');
  });
});
