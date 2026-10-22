import { parsePublicHttpsUrl } from './url-policy';

/**
 * Tên miền được chấp nhận cho link affiliate do NGƯỜI DÙNG TỰ NHẬP (nguồn USER_SUPPLIED).
 * GIẢ ĐỊNH CHƯA XÁC MINH VỚI TÀI LIỆU SHOPEE: danh sách dựa trên các tên miền rút gọn thường gặp.
 * Nếu link affiliate thật của bạn dùng tên miền khác, chỉ cần bổ sung vào đây.
 * Mục đích: chặn link trỏ tới trang lạ/lừa đảo. Link vẫn phải được người có quyền xác minh trước khi đăng.
 */
export const ALLOWED_AFFILIATE_HOSTS: ReadonlyArray<string> = [
  's.shopee.vn',
  'shope.ee',
  'shp.ee',
  'shopee.vn',
  'www.shopee.vn',
];

export type AffiliateUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function validateUserAffiliateUrl(raw: string): AffiliateUrlCheck {
  const parsed = parsePublicHttpsUrl(raw);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  const host = parsed.url.hostname.toLowerCase();
  if (!ALLOWED_AFFILIATE_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: `Tên miền ${host} không nằm trong danh sách link affiliate được phép (${ALLOWED_AFFILIATE_HOSTS.join(', ')}).`,
    };
  }
  return { ok: true, url: parsed.url.toString() };
}
