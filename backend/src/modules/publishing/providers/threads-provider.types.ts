export interface ThreadsPublishRequest {
  /** Cùng một khóa phải cho cùng một kết quả với nhà cung cấp giả lập. Threads thật KHÔNG hỗ trợ khóa này (xem official-threads.provider). */
  idempotencyKey: string;
  accountExternalId: string;
  /** Token truy cập đã giải mã (chỉ tài khoản thật); null với tài khoản giả lập. Không bao giờ ghi log. */
  accessToken: string | null;
  text: string;
  /** Có media đính kèm hay không. Tải media thật lên Threads cần URL công khai, chưa làm. */
  hasMedia: boolean;
}

export interface ThreadsReplyRequest {
  idempotencyKey: string;
  accountExternalId: string;
  accessToken: string | null;
  /** Id bài chính (do Threads trả về khi đăng). */
  replyToExternalId: string;
  text: string;
}

export interface ThreadsPublishResult {
  externalPostId: string;
  permalink: string | null;
}

export interface ThreadsProfile {
  id: string;
  username: string;
}

/** AUTH: token sai/hết hạn/thiếu quyền. RATE_LIMIT: vượt hạn mức. REJECTED: Threads từ chối nội dung. OTHER: còn lại. */
export type ThreadsErrorReason = 'AUTH' | 'RATE_LIMIT' | 'REJECTED' | 'OTHER';

/**
 * NOT_SENT: lỗi xảy ra TRƯỚC khi bài được gửi đi (từ chối xác thực, vượt hạn mức, nội dung bị từ chối...), thử lại an toàn.
 * UNKNOWN: không biết bài đã lên chưa (hết thời gian chờ, mất kết nối giữa chừng). KHÔNG được tự thử lại.
 */
export class ThreadsPublishError extends Error {
  constructor(
    readonly kind: 'NOT_SENT' | 'UNKNOWN',
    message: string,
    readonly reason: ThreadsErrorReason = 'OTHER',
  ) {
    super(message);
    this.name = 'ThreadsPublishError';
  }
}

export interface ThreadsProvider {
  readonly mode: 'mock' | 'live';
  publishText(request: ThreadsPublishRequest): Promise<ThreadsPublishResult>;
  /** Đăng comment (trả lời) dưới bài chính. */
  publishReply(request: ThreadsReplyRequest): Promise<ThreadsPublishResult>;
  /** Xác thực token và lấy thông tin tài khoản. Chỉ dùng khi kết nối tài khoản thật. */
  fetchProfile(accessToken: string): Promise<ThreadsProfile>;
}

export const THREADS_PROVIDER = Symbol('THREADS_PROVIDER');
