export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/**
 * Chỉ chấp nhận URL công khai dạng https://tên-miền/... để chống SSRF khi sau này hệ thống
 * truy cập URL (xem media, kiểm tra link): cấm http, tài khoản/mật khẩu trong URL, cổng lạ,
 * địa chỉ IP, localhost và các tên miền nội bộ. Đây là kiểm tra cú pháp; chưa phân giải DNS.
 */
export function parsePublicHttpsUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'URL đang trống.' };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `URL dài quá ${MAX_URL_LENGTH} ký tự.` };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL không hợp lệ.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'URL phải dùng https.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL không được chứa tài khoản/mật khẩu.' };
  }
  if (url.port !== '') {
    return { ok: false, reason: 'URL không được dùng cổng tùy chỉnh.' };
  }

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host)) {
    return { ok: false, reason: 'URL không được dùng địa chỉ IP.' };
  }
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'URL trỏ tới tên miền nội bộ.' };
  }
  if (!host.includes('.')) {
    return { ok: false, reason: 'URL phải có tên miền đầy đủ.' };
  }

  return { ok: true, url };
}
