import type { Role } from '../org/OrgContext';
import type { BadgeTone } from '../ui/Badge';

export type MediaType = 'IMAGE' | 'VIDEO';
export type AssetLicenseStatus =
  | 'UNLICENSED'
  | 'NEEDS_REVIEW'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'RESTRICTED'
  | 'REJECTED';
export type LicenseType = 'OWNED' | 'CC0' | 'CC_BY' | 'COMMERCIAL_PURCHASED' | 'PARTNER_GRANTED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApiAsset {
  id: string;
  mediaType: MediaType;
  title: string;
  description: string | null;
  sourceUrl: string;
  mimeType: string | null;
  assetStatus: 'ACTIVE' | 'ARCHIVED';
  licenseStatus: AssetLicenseStatus;
  licenseExpiresAt: string | null;
  licenseCheckedAt: string | null;
  createdAt: string;
}

export interface ApiLicense {
  id: string;
  licenseType: LicenseType;
  licensorName: string | null;
  proofUrl: string | null;
  proofNote: string | null;
  attributionText: string | null;
  commercialUseAllowed: boolean;
  validFrom: string | null;
  validUntil: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ApiAssessment {
  status: AssetLicenseStatus;
  usable: boolean;
  reason: string;
  basisLicenseId: string | null;
  expiresAt: string | null;
  attributions: string[];
}

export interface AssetDetail {
  asset: ApiAsset;
  licenses: ApiLicense[];
  assessment: ApiAssessment;
}

export interface RecheckResult {
  checked: number;
  changed: number;
  expiringSoon: number;
  changes: Array<{ assetId: string; title: string; from: AssetLicenseStatus; to: AssetLicenseStatus }>;
  truncated: boolean;
}

export const LICENSE_STATUS_LABEL: Record<AssetLicenseStatus, string> = {
  UNLICENSED: 'Chưa có giấy phép',
  NEEDS_REVIEW: 'Chờ duyệt giấy phép',
  VALID: 'Hợp lệ',
  EXPIRING_SOON: 'Sắp hết hạn',
  EXPIRED: 'Hết hạn',
  RESTRICTED: 'Bị hạn chế',
  REJECTED: 'Bị từ chối',
};

export const LICENSE_STATUS_TONE: Record<AssetLicenseStatus, BadgeTone> = {
  UNLICENSED: 'neutral',
  NEEDS_REVIEW: 'wait',
  VALID: 'good',
  EXPIRING_SOON: 'wait',
  EXPIRED: 'bad',
  RESTRICTED: 'bad',
  REJECTED: 'bad',
};

export const LICENSE_TYPES: ReadonlyArray<LicenseType> = ['OWNED', 'CC0', 'CC_BY', 'COMMERCIAL_PURCHASED', 'PARTNER_GRANTED'];

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  OWNED: 'Tự sở hữu (tự chụp, tự quay, tự thiết kế)',
  CC0: 'Creative Commons CC0 (phạm vi công cộng)',
  CC_BY: 'Creative Commons BY (cần ghi nguồn)',
  COMMERCIAL_PURCHASED: 'Đã mua giấy phép thương mại',
  PARTNER_GRANTED: 'Đối tác/nhà bán cấp phép',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Bị từ chối',
};

export const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = { PENDING: 'wait', APPROVED: 'good', REJECTED: 'bad' };

export const STATUS_FILTERS: ReadonlyArray<AssetLicenseStatus> = [
  'UNLICENSED',
  'NEEDS_REVIEW',
  'VALID',
  'EXPIRING_SOON',
  'EXPIRED',
  'RESTRICTED',
  'REJECTED',
];

const WRITE_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'CONTENT_EDITOR'];
const REVIEW_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'REVIEWER'];

/** Khớp media.write / media.review ở máy chủ. Máy chủ vẫn kiểm tra lại mọi yêu cầu. */
export function canWriteMedia(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}

export function canReviewMedia(role: Role): boolean {
  return REVIEW_ROLES.includes(role);
}

export interface AssetForm {
  mediaType: MediaType;
  title: string;
  sourceUrl: string;
  description: string;
}

export const EMPTY_ASSET_FORM: AssetForm = { mediaType: 'IMAGE', title: '', sourceUrl: '', description: '' };

export type AssetFormErrors = Partial<Record<keyof AssetForm, string>>;

export function validateAssetForm(form: AssetForm): AssetFormErrors {
  const errors: AssetFormErrors = {};
  if (form.title.trim() === '') {
    errors.title = 'Cần đặt tên để dễ tìm lại.';
  }
  if (!/^https:\/\//i.test(form.sourceUrl.trim())) {
    errors.sourceUrl = 'Địa chỉ media phải bắt đầu bằng https:// (hệ thống chưa lưu file, chỉ lưu địa chỉ nơi file đang được đặt).';
  }
  return errors;
}

export function buildAssetPayload(form: AssetForm): Record<string, string> {
  const payload: Record<string, string> = {
    mediaType: form.mediaType,
    title: form.title.trim(),
    sourceUrl: form.sourceUrl.trim(),
  };
  if (form.description.trim() !== '') {
    payload.description = form.description.trim();
  }
  return payload;
}

export interface LicenseForm {
  licenseType: LicenseType;
  licensorName: string;
  proofUrl: string;
  proofNote: string;
  attributionText: string;
  commercialUseAllowed: boolean;
  validFrom: string;
  validUntil: string;
}

export const EMPTY_LICENSE_FORM: LicenseForm = {
  licenseType: 'OWNED',
  licensorName: '',
  proofUrl: '',
  proofNote: '',
  attributionText: '',
  commercialUseAllowed: true,
  validFrom: '',
  validUntil: '',
};

export type LicenseFormErrors = Partial<Record<keyof LicenseForm, string>>;

export type Need = 'required' | 'optional' | 'either';

/** Trường nào bắt buộc theo từng loại giấy phép (khớp validateLicenseInput ở máy chủ). */
export function licenseNeeds(type: LicenseType): { licensorName: Need; proofUrl: Need; proofNote: Need; attributionText: Need } {
  switch (type) {
    case 'OWNED':
      return { licensorName: 'optional', proofUrl: 'optional', proofNote: 'required', attributionText: 'optional' };
    case 'CC0':
      return { licensorName: 'optional', proofUrl: 'required', proofNote: 'optional', attributionText: 'optional' };
    case 'CC_BY':
      return { licensorName: 'required', proofUrl: 'required', proofNote: 'optional', attributionText: 'required' };
    case 'COMMERCIAL_PURCHASED':
    case 'PARTNER_GRANTED':
      return { licensorName: 'required', proofUrl: 'either', proofNote: 'either', attributionText: 'optional' };
  }
}

const ICT_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** Hết ngày `YYYY-MM-DD` theo giờ Việt Nam (UTC+7), khớp cách máy chủ hiểu ngày không kèm giờ. */
export function endOfDayVN(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) {
    return null;
  }
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== Number(m[1]) || check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return utcMidnight - ICT_OFFSET_MS + DAY_MS - 1;
}

function startOfDayVN(date: string): number | null {
  const end = endOfDayVN(date);
  return end === null ? null : end - DAY_MS + 1;
}

export function validateLicenseForm(form: LicenseForm, now: Date): LicenseFormErrors {
  const errors: LicenseFormErrors = {};
  const needs = licenseNeeds(form.licenseType);
  const licensor = form.licensorName.trim();
  const url = form.proofUrl.trim();
  const note = form.proofNote.trim();
  const attribution = form.attributionText.trim();

  if (url !== '' && !/^https:\/\//i.test(url)) {
    errors.proofUrl = 'Link bằng chứng phải bắt đầu bằng https://.';
  }
  if (needs.licensorName === 'required' && licensor === '') {
    errors.licensorName = form.licenseType === 'CC_BY' ? 'Cần tên tác giả để ghi nguồn.' : 'Cần tên bên cấp phép.';
  }
  if (form.licenseType === 'OWNED' && note.length < 10) {
    errors.proofNote = 'Hãy mô tả cách bạn tạo ra media này (tối thiểu 10 ký tự).';
  }
  if ((form.licenseType === 'CC0' || form.licenseType === 'CC_BY') && url === '' && !errors.proofUrl) {
    errors.proofUrl = 'Cần link tới trang nguồn nêu giấy phép.';
  }
  if (needs.proofUrl === 'either' && url === '' && note.length < 5) {
    errors.proofNote = 'Cần link bằng chứng hoặc ghi chú bằng chứng (số hóa đơn, mã hợp đồng...).';
  }
  if (form.licenseType === 'CC_BY' && attribution.length < 3) {
    errors.attributionText = 'Cần dòng ghi nguồn sẽ kèm khi đăng.';
  }

  const from = form.validFrom.trim() === '' ? null : startOfDayVN(form.validFrom);
  const until = form.validUntil.trim() === '' ? null : endOfDayVN(form.validUntil);
  if (form.validFrom.trim() !== '' && from === null) {
    errors.validFrom = 'Ngày bắt đầu không hợp lệ.';
  }
  if (form.validUntil.trim() !== '' && until === null) {
    errors.validUntil = 'Ngày hết hạn không hợp lệ.';
  }
  if (from !== null && until !== null && until <= from) {
    errors.validUntil = 'Ngày hết hạn phải sau ngày bắt đầu.';
  } else if (until !== null && until <= now.getTime()) {
    errors.validUntil = 'Giấy phép này đã hết hạn nên không thể đăng ký.';
  }
  return errors;
}

export function buildLicensePayload(form: LicenseForm): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {
    licenseType: form.licenseType,
    commercialUseAllowed: form.commercialUseAllowed,
  };
  const optional: Array<[keyof LicenseForm, string]> = [
    ['licensorName', form.licensorName],
    ['proofUrl', form.proofUrl],
    ['proofNote', form.proofNote],
    ['attributionText', form.attributionText],
    ['validFrom', form.validFrom],
    ['validUntil', form.validUntil],
  ];
  for (const [key, value] of optional) {
    if (value.trim() !== '') {
      payload[key] = value.trim();
    }
  }
  return payload;
}

/** Số ngày còn lại (làm tròn xuống); số âm nghĩa là đã quá hạn. null nếu không hết hạn. */
export function daysLeft(expiresAt: string | null, now: Date): number | null {
  if (expiresAt === null) {
    return null;
  }
  return Math.floor((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

export function expiryText(expiresAt: string | null, now: Date): string {
  const days = daysLeft(expiresAt, now);
  if (days === null) {
    return 'Không hết hạn';
  }
  if (days < 0) {
    return 'Đã hết hạn';
  }
  return days === 0 ? 'Hết hạn trong hôm nay' : `Còn ${days} ngày`;
}

export function validateLicenseReview(decision: 'APPROVE' | 'REJECT', note: string): string | null {
  if (decision === 'REJECT' && note.trim().length < 5) {
    return 'Hãy ghi lý do từ chối (tối thiểu 5 ký tự).';
  }
  return null;
}

/** Tóm tắt kết quả kiểm tra lại giấy phép. */
export function summarizeRecheck(r: RecheckResult): string {
  const parts = [`Đã kiểm tra ${r.checked} media, ${r.changed} thay đổi trạng thái`];
  if (r.expiringSoon > 0) {
    parts.push(`${r.expiringSoon} sắp hết hạn`);
  }
  return `${parts.join(', ')}.${r.truncated ? ' Danh sách quá dài nên chỉ kiểm tra một phần.' : ''}`;
}

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Ngày theo giờ Việt Nam, khớp cách máy chủ hiểu ngày hiệu lực. */
export function dateVN(iso: string): string {
  return VN_DATE.format(new Date(iso));
}

/** Mô tả khoảng hiệu lực của một giấy phép bằng tiếng Việt tự nhiên. */
export function validityText(validFrom: string | null, validUntil: string | null): string {
  if (validFrom === null && validUntil === null) {
    return 'Không giới hạn thời gian';
  }
  if (validFrom === null) {
    return `Đến hết ngày ${dateVN(validUntil as string)}`;
  }
  if (validUntil === null) {
    return `Từ ngày ${dateVN(validFrom)}, không hết hạn`;
  }
  return `Từ ngày ${dateVN(validFrom)} đến hết ngày ${dateVN(validUntil)}`;
}

/**
 * Chữ hiển thị hạn trong danh sách. Máy chủ chỉ lưu ngày hết hạn khi media đang dùng được,
 * nên với trạng thái khác không được suy ra "không hết hạn".
 */
export function listExpiryText(asset: Pick<ApiAsset, 'licenseStatus' | 'licenseExpiresAt'>, now: Date): string | null {
  if (asset.licenseStatus !== 'VALID' && asset.licenseStatus !== 'EXPIRING_SOON') {
    return null;
  }
  return expiryText(asset.licenseExpiresAt, now);
}
