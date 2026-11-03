import { createHash } from 'node:crypto';
import type {
  ThreadsProfile,
  ThreadsProvider,
  ThreadsPublishRequest,
  ThreadsPublishResult,
  ThreadsReplyRequest,
} from './threads-provider.types';
import { ThreadsPublishError } from './threads-provider.types';

/**
 * Threads giả lập: KHÔNG gọi mạng, KHÔNG đăng thật. Idempotent theo khóa: cùng khóa luôn trả cùng id.
 * Cho phép tiêm lỗi để test đường thất bại.
 */
export class MockThreadsProvider implements ThreadsProvider {
  readonly mode = 'mock' as const;
  /** Lỗi sẽ ném ở lần gọi đăng bài kế tiếp (dùng trong test). */
  failNext: Error | null = null;
  /** Lỗi sẽ ném ở lần gọi đăng comment kế tiếp (dùng trong test). */
  failReplyNext: Error | null = null;
  readonly published = new Map<string, ThreadsPublishResult & { text: string }>();
  readonly replies = new Map<string, ThreadsPublishResult & { text: string; replyToExternalId: string }>();

  async publishText(request: ThreadsPublishRequest): Promise<ThreadsPublishResult> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const existing = this.published.get(request.idempotencyKey);
    if (existing) {
      return { externalPostId: existing.externalPostId, permalink: existing.permalink };
    }
    const id = `mock_${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 16)}`;
    const result = { externalPostId: id, permalink: `https://mock.threads.invalid/post/${id}` };
    this.published.set(request.idempotencyKey, { ...result, text: request.text });
    return result;
  }

  async publishReply(request: ThreadsReplyRequest): Promise<ThreadsPublishResult> {
    if (this.failReplyNext) {
      const error = this.failReplyNext;
      this.failReplyNext = null;
      throw error;
    }
    const existing = this.replies.get(request.idempotencyKey);
    if (existing) {
      return { externalPostId: existing.externalPostId, permalink: existing.permalink };
    }
    const id = `mockreply_${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 16)}`;
    const result = { externalPostId: id, permalink: `https://mock.threads.invalid/reply/${id}` };
    this.replies.set(request.idempotencyKey, { ...result, text: request.text, replyToExternalId: request.replyToExternalId });
    return result;
  }

  async fetchProfile(): Promise<ThreadsProfile> {
    throw new ThreadsPublishError('NOT_SENT', 'Chế độ giả lập không kết nối tài khoản thật.');
  }
}
