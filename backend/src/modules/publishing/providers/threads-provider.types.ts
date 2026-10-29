export interface ThreadsPublishRequest {
  /** Cùng một khóa phải cho cùng một kết quả: gọi lại không được tạo bài thứ hai. */
  idempotencyKey: string;
  accountExternalId: string;
  text: string;
  /** Có media đính kèm hay không. Tải media thật lên Threads cần URL công khai, chưa làm. */
  hasMedia: boolean;
}

export interface ThreadsPublishResult {
  externalPostId: string;
  permalink: string | null;
}

/**
 * NOT_SENT: lỗi xảy ra TRƯỚC khi bài được gửi đi (từ chối xác thực, vượt hạn mức, nội dung bị từ chối...), thử lại an toàn.
 * UNKNOWN: không biết bài đã lên chưa (hết thời gian chờ, mất kết nối giữa chừng). KHÔNG được tự thử lại.
 */
export class ThreadsPublishError extends Error {
  constructor(
    readonly kind: 'NOT_SENT' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'ThreadsPublishError';
  }
}

export interface ThreadsProvider {
  readonly mode: 'mock' | 'live';
  publishText(request: ThreadsPublishRequest): Promise<ThreadsPublishResult>;
}

export const THREADS_PROVIDER = Symbol('THREADS_PROVIDER');
