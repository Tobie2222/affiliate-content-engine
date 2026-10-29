import { createHash } from 'node:crypto';
import type { ThreadsProvider, ThreadsPublishRequest, ThreadsPublishResult } from './threads-provider.types';

/**
 * Threads giả lập: KHÔNG gọi mạng, KHÔNG đăng thật. Idempotent theo khóa: cùng khóa luôn trả cùng id.
 * Cho phép tiêm lỗi để test đường thất bại.
 */
export class MockThreadsProvider implements ThreadsProvider {
  readonly mode = 'mock' as const;
  /** Lỗi sẽ ném ở lần gọi kế tiếp (dùng trong test). */
  failNext: Error | null = null;
  readonly published = new Map<string, ThreadsPublishResult & { text: string }>();

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
}
