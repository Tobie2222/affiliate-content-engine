import { parsePublicHttpsUrl } from './url-policy';

/**
 * Dữ liệu sản phẩm đã chuẩn hóa. `null` nghĩa là CHƯA BIẾT, khác với 0.
 * Hệ thống không tự điền giá, hoa hồng, đánh giá hay tồn kho.
 */
export interface ProductInput {
  externalProductId: string;
  name: string;
  description: string | null;
  category: string | null;
  productUrl: string;
  imageUrl: string | null;
  currentPrice: number | null;
  currency: string | null;
  /** Phần trăm hoa hồng, 0-100. */
  commissionRate: number | null;
}

export type RowResult =
  | { ok: true; value: ProductInput }
  | { ok: false; errors: string[] };

/** Các cột CSV (chữ thường). Cột bắt buộc: external_product_id, name, product_url. */
export const CSV_COLUMNS = [
  'external_product_id',
  'name',
  'product_url',
  'description',
  'category',
  'image_url',
  'price',
  'currency',
  'commission_rate',
] as const;
export const CSV_REQUIRED_COLUMNS = ['external_product_id', 'name', 'product_url'] as const;

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const MAX_PRICE = 1e13;

function clean(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeProductRow(raw: Record<string, string | undefined>): RowResult {
  const errors: string[] = [];

  const externalProductId = clean(raw.external_product_id);
  if (!externalProductId) {
    errors.push('Thiếu external_product_id.');
  } else if (externalProductId.length > 100) {
    errors.push('external_product_id dài quá 100 ký tự.');
  }

  const name = clean(raw.name);
  if (!name) {
    errors.push('Thiếu name.');
  } else if (name.length > 500) {
    errors.push('name dài quá 500 ký tự.');
  }

  let productUrl = '';
  const rawProductUrl = clean(raw.product_url);
  if (!rawProductUrl) {
    errors.push('Thiếu product_url.');
  } else {
    const check = parsePublicHttpsUrl(rawProductUrl);
    if (check.ok) {
      productUrl = check.url.toString();
    } else {
      errors.push(`product_url: ${check.reason}`);
    }
  }

  let imageUrl: string | null = null;
  const rawImageUrl = clean(raw.image_url);
  if (rawImageUrl) {
    const check = parsePublicHttpsUrl(rawImageUrl);
    if (check.ok) {
      imageUrl = check.url.toString();
    } else {
      errors.push(`image_url: ${check.reason}`);
    }
  }

  let currentPrice: number | null = null;
  const rawPrice = clean(raw.price);
  if (rawPrice !== null) {
    if (!DECIMAL.test(rawPrice) || Number(rawPrice) > MAX_PRICE) {
      errors.push('price không hợp lệ (chỉ nhập số, dùng dấu chấm cho phần thập phân, không dùng dấu phân cách hàng nghìn).');
    } else {
      currentPrice = Number(rawPrice);
    }
  }

  let currency: string | null = null;
  const rawCurrency = clean(raw.currency);
  if (rawCurrency !== null) {
    if (/^[A-Za-z]{3}$/.test(rawCurrency)) {
      currency = rawCurrency.toUpperCase();
    } else {
      errors.push('currency phải là mã 3 chữ cái (ví dụ VND).');
    }
  }
  if (currentPrice !== null && currency === null && rawCurrency === null) {
    // Không tự đoán đơn vị tiền tệ.
    errors.push('Có price thì phải có currency.');
  }

  let commissionRate: number | null = null;
  const rawCommission = clean(raw.commission_rate);
  if (rawCommission !== null) {
    const numeric = rawCommission.endsWith('%') ? rawCommission.slice(0, -1).trim() : rawCommission;
    if (!DECIMAL.test(numeric) || Number(numeric) > 100) {
      errors.push('commission_rate phải là số từ 0 đến 100 (phần trăm).');
    } else {
      commissionRate = Number(numeric);
    }
  }

  const description = clean(raw.description);
  const category = clean(raw.category);
  if (category && category.length > 200) {
    errors.push('category dài quá 200 ký tự.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      externalProductId: externalProductId as string,
      name: name as string,
      description,
      category,
      productUrl,
      imageUrl,
      currentPrice,
      currency,
      commissionRate,
    },
  };
}
