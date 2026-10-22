export type LinkStatus = 'UNVERIFIED' | 'ACTIVE' | 'INVALID' | 'REVOKED';
export type LinkSource = 'USER_SUPPLIED' | 'PROVIDER_API' | 'MOCK';

export type PublishableCheck = { ok: true } | { ok: false; reason: string };

/**
 * Link affiliate có được dùng để đăng bài không. Đây là điều kiện `affiliateLink` mà state machine
 * nội dung kiểm tra lại ngay trước khi lên lịch/đăng (Phase 4-5).
 * - Chỉ link ACTIVE mới đăng được: link người dùng tự nhập (UNVERIFIED) phải được xác minh trước.
 * - Link do Shopee giả (MOCK) không bao giờ được đăng trên production.
 */
export function checkLinkPublishable(
  link: { status: LinkStatus; source: LinkSource },
  nodeEnv: string,
): PublishableCheck {
  if (link.status === 'UNVERIFIED') {
    return { ok: false, reason: 'Link chưa được xác minh.' };
  }
  if (link.status !== 'ACTIVE') {
    return { ok: false, reason: `Link ở trạng thái ${link.status}.` };
  }
  if (link.source === 'MOCK' && nodeEnv === 'production') {
    return { ok: false, reason: 'Link giả lập (MOCK) không được dùng trên production.' };
  }
  return { ok: true };
}
