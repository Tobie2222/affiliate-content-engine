import type { Role } from '../org/OrgContext';

export interface ScoreFactor {
  factor: string;
  points: number;
  max: number;
  note: string;
}

export interface ProductScore {
  score: number;
  max: 100;
  breakdown: ScoreFactor[];
  missing: string[];
}

export type DataSource = 'CSV' | 'MANUAL' | 'MOCK' | 'API';

export interface ApiProduct {
  id: string;
  externalProductId: string;
  name: string;
  description: string | null;
  category: string | null;
  productUrl: string;
  imageUrl: string | null;
  currentPrice: number | null;
  currency: string | null;
  commissionRate: number | null;
  productStatus: string;
  priceVerifiedAt: string | null;
  commissionVerifiedAt: string | null;
  dataSource: DataSource;
  lastSyncedAt: string | null;
  score: ProductScore;
}

export type LinkStatus = 'UNVERIFIED' | 'ACTIVE' | 'INVALID' | 'REVOKED';

export interface ApiLink {
  id: string;
  productId: string;
  affiliateUrl: string;
  source: 'USER_SUPPLIED' | 'PROVIDER_API' | 'MOCK';
  linkStatus: LinkStatus;
  subId: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  publishable: { ok: true } | { ok: false; reason: string };
}

export interface ApiConnection {
  id: string;
  provider: 'SHOPEE';
  connectionStatus: 'MOCK' | 'ACTIVE' | 'DISCONNECTED' | 'ERROR';
  lastSyncedAt: string | null;
}

export interface RowIssue {
  line: number;
  errors: string[];
}

export interface BulkResult {
  totalRows: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  errors: RowIssue[];
}

export interface ImportResult extends BulkResult {
  dryRun: boolean;
  ignoredColumns: string[];
}

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  CSV: 'Nhập CSV',
  MANUAL: 'Nhập tay',
  MOCK: 'Dữ liệu giả lập',
  API: 'Từ Shopee',
};

export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  UNVERIFIED: 'Chưa xác minh',
  ACTIVE: 'Đã xác minh',
  INVALID: 'Không hợp lệ',
  REVOKED: 'Đã thu hồi',
};

export const LINK_SOURCE_LABEL: Record<ApiLink['source'], string> = {
  USER_SUPPLIED: 'Bạn tự nhập',
  PROVIDER_API: 'Do Shopee tạo',
  MOCK: 'Giả lập',
};

export const CSV_TEMPLATE =
  'external_product_id,name,product_url,description,category,image_url,price,currency,commission_rate\n' +
  'SP001,Bình giữ nhiệt 500ml,https://shopee.vn/product/123/456,Giữ nóng 8 giờ,Gia dụng,,189000,VND,8';

/** Khớp ngưỡng giá cũ của bộ kiểm tra QA ở máy chủ (PRICE_STALE_DAYS). */
export const PRICE_STALE_DAYS = 7;
export const MAX_CSV_CHARS = 50_000;

const WRITE_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'CONTENT_EDITOR'];
const VERIFY_ROLES: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'REVIEWER'];

/** Khớp catalog.write / links.verify ở máy chủ. Máy chủ vẫn kiểm tra lại mọi yêu cầu. */
export function canWriteCatalog(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}

export function canVerifyLinks(role: Role): boolean {
  return VERIFY_ROLES.includes(role);
}

export function linkActions(link: Pick<ApiLink, 'linkStatus'>, role: Role): { canVerify: boolean; canRevoke: boolean } {
  return {
    canVerify: canVerifyLinks(role) && link.linkStatus === 'UNVERIFIED',
    canRevoke: canWriteCatalog(role) && (link.linkStatus === 'UNVERIFIED' || link.linkStatus === 'ACTIVE'),
  };
}

const CURRENCY_SYMBOL: Record<string, string> = { VND: 'đ' };

/** Giá chưa biết hiển thị rõ là "chưa biết", không phải 0. */
export function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) {
    return 'Chưa biết giá';
  }
  const amount = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(price);
  const code = currency ?? '';
  return `${amount} ${CURRENCY_SYMBOL[code] ?? code}`.trim();
}

export function formatCommission(rate: number | null): string {
  return rate === null ? 'Chưa biết' : `${rate}%`;
}

export type PriceFreshness = 'unknown' | 'fresh' | 'stale';

export function priceFreshness(price: number | null, verifiedAt: string | null, now: Date): PriceFreshness {
  if (price === null || verifiedAt === null) {
    return 'unknown';
  }
  const ageDays = (now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000;
  return ageDays > PRICE_STALE_DAYS ? 'stale' : 'fresh';
}

export const FRESHNESS_LABEL: Record<PriceFreshness, string> = {
  unknown: 'Giá chưa được xác minh',
  fresh: 'Giá còn mới',
  stale: `Giá đã cũ (quá ${PRICE_STALE_DAYS} ngày), cần cập nhật trước khi đăng`,
};

/**
 * Đọc số người dùng gõ. Chỉ nhận số không có dấu phân cách hàng nghìn, tối đa 2 chữ số thập phân.
 * "189.000" và "189,000" bị từ chối thay vì bị hiểu nhầm thành 189.
 */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) {
    return null;
  }
  return Number(t.replace(',', '.'));
}

export interface ProductForm {
  externalProductId: string;
  name: string;
  productUrl: string;
  description: string;
  category: string;
  imageUrl: string;
  price: string;
  currency: string;
  commissionRate: string;
}

export const EMPTY_PRODUCT_FORM: ProductForm = {
  externalProductId: '',
  name: '',
  productUrl: '',
  description: '',
  category: '',
  imageUrl: '',
  price: '',
  currency: 'VND',
  commissionRate: '',
};

export type ProductFormErrors = Partial<Record<keyof ProductForm, string>>;

const NUMBER_HINT = 'Nhập số không có dấu phân cách hàng nghìn, ví dụ 189000.';

/** Kiểm tra nhanh phía trình duyệt; máy chủ vẫn là nơi quyết định. */
export function validateProductForm(form: ProductForm): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (form.externalProductId.trim() === '') {
    errors.externalProductId = 'Cần mã sản phẩm (ví dụ mã trên Shopee).';
  }
  if (form.name.trim() === '') {
    errors.name = 'Cần tên sản phẩm.';
  }
  if (!/^https?:\/\//i.test(form.productUrl.trim())) {
    errors.productUrl = 'Link sản phẩm phải bắt đầu bằng http:// hoặc https://.';
  }
  if (form.price.trim() !== '') {
    if (parseDecimal(form.price) === null) {
      errors.price = NUMBER_HINT;
    } else if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) {
      errors.currency = 'Có giá thì cần mã tiền tệ 3 chữ cái, ví dụ VND.';
    }
  }
  if (form.commissionRate.trim() !== '') {
    const rate = parseDecimal(form.commissionRate);
    if (rate === null) {
      errors.commissionRate = 'Nhập số từ 0 đến 100, ví dụ 8 hoặc 7.5.';
    } else if (rate > 100) {
      errors.commissionRate = 'Hoa hồng tối đa 100%.';
    }
  }
  return errors;
}

/** Ô bỏ trống nghĩa là "chưa biết" và KHÔNG được gửi đi (khác với 0). */
export function buildProductPayload(form: ProductForm): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    externalProductId: form.externalProductId.trim(),
    name: form.name.trim(),
    productUrl: form.productUrl.trim(),
  };
  const optional: Array<[keyof ProductForm, string]> = [
    ['description', form.description],
    ['category', form.category],
    ['imageUrl', form.imageUrl],
  ];
  for (const [key, value] of optional) {
    if (value.trim() !== '') {
      payload[key] = value.trim();
    }
  }
  const price = form.price.trim() === '' ? null : parseDecimal(form.price);
  if (price !== null) {
    payload.price = price;
    payload.currency = form.currency.trim().toUpperCase();
  }
  const rate = form.commissionRate.trim() === '' ? null : parseDecimal(form.commissionRate);
  if (rate !== null) {
    payload.commissionRate = rate;
  }
  return payload;
}

/** Tóm tắt kết quả nhập CSV / đồng bộ thành các dòng dễ đọc. */
export function summarizeBulk(result: BulkResult & { dryRun?: boolean }): string {
  const parts: string[] = [];
  if (result.dryRun) {
    parts.push(`Kiểm tra ${result.totalRows} dòng: ${result.valid} hợp lệ, ${result.invalid} lỗi. Chưa ghi gì vào hệ thống.`);
  } else {
    parts.push(`Xử lý ${result.totalRows} dòng: thêm mới ${result.created}, cập nhật ${result.updated}, lỗi ${result.invalid}.`);
  }
  return parts.join(' ');
}

export function scoreTone(score: number): 'good' | 'wait' | 'bad' {
  if (score >= 70) {
    return 'good';
  }
  return score >= 40 ? 'wait' : 'bad';
}
