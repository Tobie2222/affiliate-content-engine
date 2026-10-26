import { parsePublicHttpsUrl } from '../affiliate/url-policy';

/**
 * Quy tắc giấy phép media. Đây là logic thuần (không DB) để test được và dùng lại ở Phase 4
 * (QA kiểm tra media trước khi duyệt) và Phase 5 (kiểm tra lại ngay trước khi đăng).
 *
 * Nguyên tắc: hệ thống KHÔNG tự xác nhận giấy phép. Người dùng khai báo, một người có quyền duyệt xác nhận.
 * AI/agent không được phép chuyển giấy phép sang APPROVED.
 */

export const LICENSE_TYPES = ['OWNED', 'CC0', 'CC_BY', 'COMMERCIAL_PURCHASED', 'PARTNER_GRANTED'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  OWNED: 'Tự sở hữu (tự chụp, tự quay, tự thiết kế)',
  CC0: 'Creative Commons CC0 (phạm vi công cộng)',
  CC_BY: 'Creative Commons BY (cần ghi nguồn)',
  COMMERCIAL_PURCHASED: 'Đã mua giấy phép thương mại',
  PARTNER_GRANTED: 'Đối tác/nhà bán cấp phép',
};

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type LicenseState =
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'NOT_COMMERCIAL'
  | 'EXPIRING_SOON'
  | 'VALID';

export type AssetLicenseStatus =
  | 'UNLICENSED'
  | 'NEEDS_REVIEW'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'RESTRICTED'
  | 'REJECTED';

export const ASSET_LICENSE_STATUSES: ReadonlyArray<AssetLicenseStatus> = [
  'UNLICENSED',
  'NEEDS_REVIEW',
  'VALID',
  'EXPIRING_SOON',
  'EXPIRED',
  'RESTRICTED',
  'REJECTED',
];

/** Giấy phép còn dưới ngần này ngày thì cảnh báo sắp hết hạn (vẫn dùng được). */
export const EXPIRING_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LicenseFacts {
  id: string;
  licenseType: LicenseType;
  reviewStatus: ReviewStatus;
  commercialUseAllowed: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  attributionText: string | null;
}

/** Trạng thái của MỘT giấy phép tại thời điểm `now`. Hết hạn khi now >= validUntil. */
export function licenseState(license: LicenseFacts, now: Date): LicenseState {
  if (license.reviewStatus === 'REJECTED') {
    return 'REJECTED';
  }
  if (license.reviewStatus === 'PENDING') {
    return 'PENDING_REVIEW';
  }
  if (license.validUntil && now.getTime() >= license.validUntil.getTime()) {
    return 'EXPIRED';
  }
  if (license.validFrom && now.getTime() < license.validFrom.getTime()) {
    return 'NOT_STARTED';
  }
  if (!license.commercialUseAllowed) {
    return 'NOT_COMMERCIAL'; // nội dung affiliate là mục đích thương mại
  }
  if (license.validUntil && license.validUntil.getTime() - now.getTime() < EXPIRING_SOON_DAYS * DAY_MS) {
    return 'EXPIRING_SOON';
  }
  return 'VALID';
}

// Thứ tự ưu tiên khi một media có nhiều giấy phép: lấy giấy phép "tốt nhất".
const STATE_RANK: Record<LicenseState, number> = {
  VALID: 0,
  EXPIRING_SOON: 1,
  PENDING_REVIEW: 2,
  EXPIRED: 3,
  NOT_STARTED: 4,
  NOT_COMMERCIAL: 5,
  REJECTED: 6,
};

const STATE_TO_ASSET: Record<LicenseState, AssetLicenseStatus> = {
  VALID: 'VALID',
  EXPIRING_SOON: 'EXPIRING_SOON',
  PENDING_REVIEW: 'NEEDS_REVIEW',
  EXPIRED: 'EXPIRED',
  NOT_STARTED: 'RESTRICTED',
  NOT_COMMERCIAL: 'RESTRICTED',
  REJECTED: 'REJECTED',
};

export const ASSET_STATUS_REASON: Record<AssetLicenseStatus, string> = {
  UNLICENSED: 'Media chưa có giấy phép nào.',
  NEEDS_REVIEW: 'Giấy phép đang chờ người có quyền duyệt xác nhận.',
  VALID: 'Giấy phép hợp lệ.',
  EXPIRING_SOON: `Giấy phép còn dưới ${EXPIRING_SOON_DAYS} ngày; cần gia hạn trước khi hết hạn.`,
  EXPIRED: 'Giấy phép đã hết hạn.',
  RESTRICTED: 'Giấy phép chưa có hiệu lực hoặc không cho phép dùng thương mại.',
  REJECTED: 'Giấy phép đã bị từ chối.',
};

export interface AssetAssessment {
  status: AssetLicenseStatus;
  /** Có được dùng trong nội dung hay không. */
  usable: boolean;
  reason: string;
  /** Giấy phép đang làm căn cứ (null nếu không có giấy phép nào). */
  basisLicenseId: string | null;
  /** Thời điểm giấy phép căn cứ hết hạn; null = không hết hạn hoặc không có căn cứ. */
  expiresAt: Date | null;
  /** Dòng ghi nguồn bắt buộc phải kèm khi dùng (CC BY). */
  attributions: string[];
}

function expiryOrder(d: Date | null): number {
  return d === null ? Number.POSITIVE_INFINITY : d.getTime(); // không hết hạn xếp cao nhất
}

export function assessAsset(licenses: ReadonlyArray<LicenseFacts>, now: Date): AssetAssessment {
  if (licenses.length === 0) {
    return {
      status: 'UNLICENSED',
      usable: false,
      reason: ASSET_STATUS_REASON.UNLICENSED,
      basisLicenseId: null,
      expiresAt: null,
      attributions: [],
    };
  }

  const evaluated = licenses.map((license) => ({ license, state: licenseState(license, now) }));
  evaluated.sort((a, b) => {
    const byRank = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byRank !== 0) {
      return byRank;
    }
    return expiryOrder(b.license.validUntil) - expiryOrder(a.license.validUntil);
  });

  const best = evaluated[0];
  const status = STATE_TO_ASSET[best.state];
  const usable = status === 'VALID' || status === 'EXPIRING_SOON';

  const attributions = usable
    ? Array.from(
        new Set(
          evaluated
            .filter((e) => e.license.id === best.license.id)
            .map((e) => e.license.attributionText?.trim() ?? '')
            .filter((text) => text.length > 0),
        ),
      )
    : [];

  return {
    status,
    usable,
    reason: ASSET_STATUS_REASON[status],
    basisLicenseId: best.license.id,
    expiresAt: usable ? best.license.validUntil : null,
    attributions,
  };
}

// ---------- Kiểm tra dữ liệu giấy phép người dùng khai báo ----------

export interface LicenseInput {
  licenseType: LicenseType;
  licensorName?: string | null;
  proofUrl?: string | null;
  proofNote?: string | null;
  attributionText?: string | null;
  commercialUseAllowed: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface ValidLicense {
  licenseType: LicenseType;
  licensorName: string | null;
  proofUrl: string | null;
  proofNote: string | null;
  attributionText: string | null;
  commercialUseAllowed: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
}

export type LicenseValidation = { ok: true; value: ValidLicense } | { ok: false; errors: string[] };

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 (giờ Việt Nam)

/**
 * Nhận 'YYYY-MM-DD' hoặc chuỗi ngày giờ ISO có múi giờ. Ngày không kèm giờ được hiểu theo giờ Việt Nam
 * (UTC+7): đầu ngày với validFrom, cuối ngày (hết 23:59:59.999) với validUntil.
 */
export function parseValidityDate(raw: string, edge: 'start' | 'end'): Date | null {
  const text = raw.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const utcMidnight = Date.UTC(Number(y), Number(m) - 1, Number(d));
    const check = new Date(utcMidnight);
    if (
      check.getUTCFullYear() !== Number(y) ||
      check.getUTCMonth() !== Number(m) - 1 ||
      check.getUTCDate() !== Number(d)
    ) {
      return null; // ví dụ 2026-02-30
    }
    const startUtc = utcMidnight - ICT_OFFSET_MS;
    return new Date(edge === 'start' ? startUtc : startUtc + DAY_MS - 1);
  }
  // Ngày giờ đầy đủ bắt buộc có múi giờ (Z hoặc ±hh:mm) để không phụ thuộc máy chủ.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export function validateLicenseInput(input: LicenseInput, now: Date): LicenseValidation {
  const errors: string[] = [];
  const licensorName = clean(input.licensorName);
  const proofUrlRaw = clean(input.proofUrl);
  const proofNote = clean(input.proofNote);
  const attributionText = clean(input.attributionText);

  if (!LICENSE_TYPES.includes(input.licenseType)) {
    errors.push('Loại giấy phép không hợp lệ.');
  }

  let proofUrl: string | null = null;
  if (proofUrlRaw) {
    const check = parsePublicHttpsUrl(proofUrlRaw);
    if (check.ok) {
      proofUrl = check.url.toString();
    } else {
      errors.push(`Link bằng chứng: ${check.reason}`);
    }
  }

  switch (input.licenseType) {
    case 'OWNED':
      if (!proofNote || proofNote.length < 10) {
        errors.push('Tự sở hữu: cần mô tả cách bạn tạo ra media này (tối thiểu 10 ký tự).');
      }
      break;
    case 'CC0':
      if (!proofUrlRaw) {
        errors.push('CC0: cần link tới trang nguồn nêu giấy phép.');
      }
      break;
    case 'CC_BY':
      if (!proofUrlRaw) {
        errors.push('CC BY: cần link tới trang nguồn nêu giấy phép.');
      }
      if (!licensorName) {
        errors.push('CC BY: cần tên tác giả để ghi nguồn.');
      }
      if (!attributionText || attributionText.length < 3) {
        errors.push('CC BY: cần dòng ghi nguồn sẽ kèm khi đăng.');
      }
      break;
    case 'COMMERCIAL_PURCHASED':
    case 'PARTNER_GRANTED':
      if (!licensorName) {
        errors.push('Cần tên bên cấp phép.');
      }
      if (!proofUrlRaw && (!proofNote || proofNote.length < 5)) {
        errors.push('Cần link bằng chứng hoặc ghi chú bằng chứng (số hóa đơn, mã hợp đồng...).');
      }
      break;
    default:
      break;
  }

  let validFrom: Date | null = null;
  let validUntil: Date | null = null;
  if (clean(input.validFrom)) {
    validFrom = parseValidityDate(input.validFrom as string, 'start');
    if (!validFrom) {
      errors.push('Ngày bắt đầu không hợp lệ (dùng YYYY-MM-DD hoặc ngày giờ ISO kèm múi giờ).');
    }
  }
  if (clean(input.validUntil)) {
    validUntil = parseValidityDate(input.validUntil as string, 'end');
    if (!validUntil) {
      errors.push('Ngày hết hạn không hợp lệ (dùng YYYY-MM-DD hoặc ngày giờ ISO kèm múi giờ).');
    }
  }
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    errors.push('Ngày hết hạn phải sau ngày bắt đầu.');
  }
  if (validUntil && validUntil.getTime() <= now.getTime()) {
    errors.push('Giấy phép này đã hết hạn nên không thể đăng ký.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      licenseType: input.licenseType,
      licensorName,
      proofUrl,
      proofNote,
      attributionText,
      commercialUseAllowed: input.commercialUseAllowed,
      validFrom,
      validUntil,
    },
  };
}
