/** Dữ liệu sản phẩm/link/media mà màn hình nội dung cần để chọn khi soạn bài. */

export interface ProductItem {
  id: string;
  name: string;
  category: string | null;
}

export type Publishable = { ok: true } | { ok: false; reason: string };

export interface LinkItem {
  id: string;
  productId: string;
  affiliateUrl: string;
  linkStatus: string;
  publishable: Publishable;
}

export interface MediaItem {
  id: string;
  title: string;
  mediaType: 'IMAGE' | 'VIDEO';
  licenseStatus: string;
}

export const LICENSE_LABEL: Record<string, string> = {
  UNLICENSED: 'chưa có giấy phép',
  NEEDS_REVIEW: 'chờ duyệt giấy phép',
  VALID: 'hợp lệ',
  EXPIRING_SOON: 'sắp hết hạn',
  EXPIRED: 'hết hạn',
  RESTRICTED: 'bị hạn chế',
  REJECTED: 'bị từ chối',
};

export const LINK_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'đã xác minh',
  UNVERIFIED: 'chưa xác minh',
};

/** Giấy phép đủ để đưa vào bài (khớp mức VALID / EXPIRING_SOON của máy chủ). */
export function mediaUsable(licenseStatus: string): boolean {
  return licenseStatus === 'VALID' || licenseStatus === 'EXPIRING_SOON';
}

export function linkOptionLabel(link: LinkItem): string {
  const status = LINK_STATUS_LABEL[link.linkStatus] ?? link.linkStatus.toLowerCase();
  const tail = link.publishable.ok ? '' : ' (chưa đăng được)';
  return `${link.affiliateUrl} - ${status}${tail}`;
}

export function mediaOptionLabel(media: MediaItem): string {
  const status = LICENSE_LABEL[media.licenseStatus] ?? media.licenseStatus.toLowerCase();
  const tail = mediaUsable(media.licenseStatus) ? '' : ' (chưa dùng được)';
  return `${media.title} - ${status}${tail}`;
}

/** Ưu tiên link đăng được; nếu không có thì lấy link đầu tiên để người dùng thấy lý do. */
export function pickDefaultLink(links: ReadonlyArray<LinkItem>): string {
  return (links.find((l) => l.publishable.ok) ?? links[0])?.id ?? '';
}
