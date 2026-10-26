import {
  EXPIRING_SOON_DAYS,
  LicenseFacts,
  LicenseInput,
  assessAsset,
  licenseState,
  parseValidityDate,
  validateLicenseInput,
} from './license-policy';

const NOW = new Date('2026-10-26T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

let seq = 0;
function lic(partial: Partial<LicenseFacts> = {}): LicenseFacts {
  seq++;
  return {
    id: `l${seq}`,
    licenseType: 'OWNED',
    reviewStatus: 'APPROVED',
    commercialUseAllowed: true,
    validFrom: null,
    validUntil: null,
    attributionText: null,
    ...partial,
  };
}

describe('licenseState', () => {
  it('chưa duyệt thì chờ duyệt, bị từ chối thì REJECTED, dù còn hạn', () => {
    expect(licenseState(lic({ reviewStatus: 'PENDING' }), NOW)).toBe('PENDING_REVIEW');
    expect(licenseState(lic({ reviewStatus: 'REJECTED' }), NOW)).toBe('REJECTED');
  });

  it('đã duyệt, không hạn: hợp lệ mãi', () => {
    expect(licenseState(lic(), NOW)).toBe('VALID');
  });

  it('hết hạn đúng thời điểm validUntil (không còn dùng được tại chính mốc đó)', () => {
    expect(licenseState(lic({ validUntil: NOW }), NOW)).toBe('EXPIRED');
    expect(licenseState(lic({ validUntil: new Date(NOW.getTime() + 1) }), NOW)).toBe('EXPIRING_SOON');
    expect(licenseState(lic({ validUntil: inDays(-1) }), NOW)).toBe('EXPIRED');
  });

  it('sắp hết hạn trong vòng ngưỡng cảnh báo', () => {
    expect(licenseState(lic({ validUntil: inDays(EXPIRING_SOON_DAYS - 1) }), NOW)).toBe('EXPIRING_SOON');
    expect(licenseState(lic({ validUntil: inDays(EXPIRING_SOON_DAYS) }), NOW)).toBe('VALID');
  });

  it('chưa tới ngày bắt đầu thì chưa có hiệu lực', () => {
    expect(licenseState(lic({ validFrom: inDays(1) }), NOW)).toBe('NOT_STARTED');
    expect(licenseState(lic({ validFrom: NOW }), NOW)).toBe('VALID');
  });

  it('không cho dùng thương mại thì không dùng được cho nội dung affiliate', () => {
    expect(licenseState(lic({ commercialUseAllowed: false }), NOW)).toBe('NOT_COMMERCIAL');
  });

  it('hết hạn được ưu tiên báo trước các lỗi khác của giấy phép đã duyệt', () => {
    expect(licenseState(lic({ validUntil: inDays(-1), commercialUseAllowed: false }), NOW)).toBe('EXPIRED');
  });
});

describe('assessAsset', () => {
  it('không có giấy phép: UNLICENSED và không dùng được', () => {
    const a = assessAsset([], NOW);
    expect(a.status).toBe('UNLICENSED');
    expect(a.usable).toBe(false);
    expect(a.basisLicenseId).toBe(null);
  });

  it('chỉ giấy phép chờ duyệt: NEEDS_REVIEW, chưa dùng được', () => {
    const a = assessAsset([lic({ reviewStatus: 'PENDING' })], NOW);
    expect(a.status).toBe('NEEDS_REVIEW');
    expect(a.usable).toBe(false);
  });

  it('giấy phép hợp lệ: dùng được, không có hạn', () => {
    const l = lic();
    const a = assessAsset([l], NOW);
    expect(a).toMatchObject({ status: 'VALID', usable: true, basisLicenseId: l.id, expiresAt: null });
  });

  it('sắp hết hạn vẫn dùng được nhưng báo hạn', () => {
    const until = inDays(5);
    const a = assessAsset([lic({ validUntil: until })], NOW);
    expect(a.status).toBe('EXPIRING_SOON');
    expect(a.usable).toBe(true);
    expect(a.expiresAt).toEqual(until);
  });

  it('hết hạn, bị từ chối, hạn chế: không dùng được', () => {
    expect(assessAsset([lic({ validUntil: inDays(-2) })], NOW)).toMatchObject({ status: 'EXPIRED', usable: false });
    expect(assessAsset([lic({ reviewStatus: 'REJECTED' })], NOW)).toMatchObject({ status: 'REJECTED', usable: false });
    expect(assessAsset([lic({ commercialUseAllowed: false })], NOW)).toMatchObject({ status: 'RESTRICTED', usable: false });
    expect(assessAsset([lic({ validFrom: inDays(3) })], NOW)).toMatchObject({ status: 'RESTRICTED', usable: false });
  });

  it('nhiều giấy phép: lấy giấy phép tốt nhất; một giấy phép còn hạn cứu được media có giấy phép cũ đã hết hạn', () => {
    const old = lic({ validUntil: inDays(-30) });
    const fresh = lic({ validUntil: inDays(200) });
    const a = assessAsset([old, fresh], NOW);
    expect(a).toMatchObject({ status: 'VALID', usable: true, basisLicenseId: fresh.id });
  });

  it('cùng mức tốt: ưu tiên giấy phép không hết hạn, rồi giấy phép hết hạn muộn hơn', () => {
    const limited = lic({ validUntil: inDays(100) });
    const forever = lic();
    expect(assessAsset([limited, forever], NOW).basisLicenseId).toBe(forever.id);
    const later = lic({ validUntil: inDays(300) });
    expect(assessAsset([limited, later], NOW).basisLicenseId).toBe(later.id);
  });

  it('giấy phép chờ duyệt không "che" một giấy phép đã hết hạn: báo NEEDS_REVIEW (đang chờ), vẫn không dùng được', () => {
    const a = assessAsset([lic({ validUntil: inDays(-1) }), lic({ reviewStatus: 'PENDING' })], NOW);
    expect(a.status).toBe('NEEDS_REVIEW');
    expect(a.usable).toBe(false);
  });

  it('CC BY: trả về dòng ghi nguồn bắt buộc, chỉ khi dùng được', () => {
    const l = lic({ licenseType: 'CC_BY', attributionText: ' Ảnh: Nguyễn A / CC BY 4.0 ' });
    expect(assessAsset([l], NOW).attributions).toEqual(['Ảnh: Nguyễn A / CC BY 4.0']);
    const expired = lic({ licenseType: 'CC_BY', attributionText: 'x y z', validUntil: inDays(-1) });
    expect(assessAsset([expired], NOW).attributions).toEqual([]);
  });

  it('không làm thay đổi mảng đầu vào', () => {
    const list = [lic({ validUntil: inDays(-1) }), lic()];
    const ids = list.map((l) => l.id);
    assessAsset(list, NOW);
    expect(list.map((l) => l.id)).toEqual(ids);
  });
});

describe('parseValidityDate', () => {
  it('ngày không kèm giờ theo giờ Việt Nam: đầu ngày và cuối ngày', () => {
    expect(parseValidityDate('2026-12-31', 'start')?.toISOString()).toBe('2026-12-30T17:00:00.000Z');
    expect(parseValidityDate('2026-12-31', 'end')?.toISOString()).toBe('2026-12-31T16:59:59.999Z');
  });

  it('chấp nhận ngày giờ ISO có múi giờ, từ chối khi thiếu múi giờ hoặc sai', () => {
    expect(parseValidityDate('2026-12-31T10:00:00Z', 'end')?.toISOString()).toBe('2026-12-31T10:00:00.000Z');
    expect(parseValidityDate('2026-12-31T10:00:00+07:00', 'end')?.toISOString()).toBe('2026-12-31T03:00:00.000Z');
    expect(parseValidityDate('2026-12-31T10:00:00', 'end')).toBe(null);
    expect(parseValidityDate('31/12/2026', 'end')).toBe(null);
    expect(parseValidityDate('2026-02-30', 'end')).toBe(null);
    expect(parseValidityDate('2026-13-01', 'end')).toBe(null);
  });
});

function input(partial: Partial<LicenseInput>): LicenseInput {
  return { licenseType: 'OWNED', commercialUseAllowed: true, ...partial };
}

describe('validateLicenseInput', () => {
  it('OWNED cần mô tả cách tạo ra media', () => {
    const bad = validateLicenseInput(input({ licenseType: 'OWNED' }), NOW);
    expect(bad.ok).toBe(false);
    const ok = validateLicenseInput(input({ licenseType: 'OWNED', proofNote: 'Ảnh tự chụp tại cửa hàng ngày 20/10' }), NOW);
    expect(ok.ok).toBe(true);
  });

  it('CC0 cần link nguồn; link phải là https công khai', () => {
    expect(validateLicenseInput(input({ licenseType: 'CC0' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ licenseType: 'CC0', proofUrl: 'http://example.com/x' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ licenseType: 'CC0', proofUrl: 'https://localhost/x' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ licenseType: 'CC0', proofUrl: 'https://example.com/photo/1' }), NOW).ok).toBe(true);
  });

  it('CC BY cần tác giả, dòng ghi nguồn và link nguồn', () => {
    const r = validateLicenseInput(input({ licenseType: 'CC_BY' }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBe(3);
    }
    const ok = validateLicenseInput(
      input({
        licenseType: 'CC_BY',
        proofUrl: 'https://example.com/photo/1',
        licensorName: 'Nguyễn A',
        attributionText: 'Ảnh: Nguyễn A / CC BY 4.0',
      }),
      NOW,
    );
    expect(ok.ok).toBe(true);
  });

  it('mua giấy phép/đối tác cấp: cần bên cấp và bằng chứng (link hoặc ghi chú)', () => {
    expect(validateLicenseInput(input({ licenseType: 'COMMERCIAL_PURCHASED' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ licenseType: 'PARTNER_GRANTED', licensorName: 'Shop A' }), NOW).ok).toBe(false);
    expect(
      validateLicenseInput(input({ licenseType: 'PARTNER_GRANTED', licensorName: 'Shop A', proofNote: 'HD-2026-014' }), NOW).ok,
    ).toBe(true);
  });

  it('ngày: hết hạn phải sau bắt đầu và phải còn trong tương lai', () => {
    const base = { licenseType: 'OWNED' as const, proofNote: 'Ảnh tự chụp tại cửa hàng' };
    expect(validateLicenseInput(input({ ...base, validFrom: '2026-12-01', validUntil: '2026-11-01' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ ...base, validUntil: '2026-10-01' }), NOW).ok).toBe(false);
    expect(validateLicenseInput(input({ ...base, validUntil: '2027-10-01' }), NOW).ok).toBe(true);
    expect(validateLicenseInput(input({ ...base, validUntil: 'mai' }), NOW).ok).toBe(false);
  });

  it('chuẩn hóa dữ liệu: cắt khoảng trắng, chuỗi rỗng thành null, link chuẩn hóa', () => {
    const r = validateLicenseInput(
      input({
        licenseType: 'CC0',
        proofUrl: '  https://example.com/a b  ',
        licensorName: '   ',
        proofNote: '',
        commercialUseAllowed: true,
      }),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.licensorName).toBe(null);
      expect(r.value.proofNote).toBe(null);
      expect(r.value.proofUrl).toBe('https://example.com/a%20b');
    }
  });

  it('cho phép đăng ký giấy phép không dùng thương mại (để ghi nhận) nhưng nó sẽ không dùng được', () => {
    const r = validateLicenseInput(
      input({ licenseType: 'OWNED', proofNote: 'Ảnh tự chụp tại cửa hàng', commercialUseAllowed: false }),
      NOW,
    );
    expect(r.ok).toBe(true);
  });
});
