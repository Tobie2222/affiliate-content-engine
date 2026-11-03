import type {
  ThreadsProfile,
  ThreadsProvider,
  ThreadsPublishRequest,
  ThreadsPublishResult,
  ThreadsReplyRequest,
} from './threads-provider.types';
import { ThreadsErrorReason, ThreadsPublishError } from './threads-provider.types';

export interface OfficialThreadsOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Số lần kiểm tra trạng thái container trước khi đăng, và khoảng chờ giữa các lần. */
  pollAttempts?: number;
  pollDelayMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_MESSAGE = 200;

/**
 * Threads API chính thức (graph.threads.com). Hai bước cho mỗi bài: tạo container rồi publish; comment dùng cùng
 * quy trình với reply_to_id.
 *
 * Phân loại lỗi để không đăng trùng:
 * - Tạo container / kiểm tra trạng thái: chưa có gì công khai nên mọi lỗi đều NOT_SENT.
 * - Bước publish: có phản hồi 4xx từ Threads = bị từ chối = NOT_SENT. Mất kết nối, hết thời gian, 5xx, phản hồi
 *   không đọc được = UNKNOWN (có thể đã đăng) -> người dùng phải kiểm tra trên Threads.
 * - Threads KHÔNG có khóa chống trùng, nên idempotencyKey không được dùng ở đây.
 *
 * Token chỉ nằm trong thân yêu cầu POST hoặc tham số GET gửi tới Threads; không đưa vào thông báo lỗi hay log.
 */
export class OfficialThreadsProvider implements ThreadsProvider {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollAttempts: number;
  private readonly pollDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OfficialThreadsOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://graph.threads.com/v1.0';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.pollAttempts = options.pollAttempts ?? 10;
    this.pollDelayMs = options.pollDelayMs ?? 3_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fetchProfile(accessToken: string): Promise<ThreadsProfile> {
    const result = await this.call('GET', '/me', { fields: 'id,username' }, accessToken);
    if (result === 'NO_RESPONSE') {
      throw new ThreadsPublishError('NOT_SENT', 'Không kết nối được tới Threads. Thử lại sau.');
    }
    if (result.status >= 400) {
      throw this.apiError('NOT_SENT', result, accessToken);
    }
    const id = typeof result.body.id === 'string' ? result.body.id : null;
    const username = typeof result.body.username === 'string' ? result.body.username : null;
    if (!id || !username) {
      throw new ThreadsPublishError('NOT_SENT', 'Threads trả về dữ liệu tài khoản không hợp lệ.');
    }
    return { id, username };
  }

  publishText(request: ThreadsPublishRequest): Promise<ThreadsPublishResult> {
    if (request.hasMedia) {
      return Promise.reject(new ThreadsPublishError('NOT_SENT', 'Đăng kèm media lên Threads thật chưa được hỗ trợ.', 'REJECTED'));
    }
    return this.publishContainer(request.accountExternalId, request.accessToken, { media_type: 'TEXT', text: request.text });
  }

  publishReply(request: ThreadsReplyRequest): Promise<ThreadsPublishResult> {
    return this.publishContainer(request.accountExternalId, request.accessToken, {
      media_type: 'TEXT',
      text: request.text,
      reply_to_id: request.replyToExternalId,
    });
  }

  private async publishContainer(
    userId: string,
    token: string | null,
    fields: Record<string, string>,
  ): Promise<ThreadsPublishResult> {
    if (!token || !userId) {
      throw new ThreadsPublishError('NOT_SENT', 'Tài khoản chưa có token Threads. Hãy kết nối lại tài khoản.', 'AUTH');
    }
    // 1) Tạo container: chưa công khai gì nên lỗi nào cũng NOT_SENT.
    const created = await this.call('POST', `/${encodeURIComponent(userId)}/threads`, fields, token);
    if (created === 'NO_RESPONSE') {
      throw new ThreadsPublishError('NOT_SENT', 'Không kết nối được tới Threads. Thử lại sau.');
    }
    if (created.status >= 400) {
      throw this.apiError('NOT_SENT', created, token);
    }
    const containerId = typeof created.body.id === 'string' ? created.body.id : null;
    if (!containerId) {
      throw new ThreadsPublishError('NOT_SENT', 'Threads không trả về mã container.');
    }

    // 2) Chờ container sẵn sàng.
    await this.waitUntilReady(containerId, token);

    // 3) Publish: từ đây một lỗi mơ hồ có thể đã đăng bài.
    const published = await this.call('POST', `/${encodeURIComponent(userId)}/threads_publish`, { creation_id: containerId }, token);
    if (published === 'NO_RESPONSE') {
      throw new ThreadsPublishError('UNKNOWN', 'Mất kết nối khi đăng: chưa rõ bài đã lên Threads hay chưa.');
    }
    if (published.status >= 500) {
      throw new ThreadsPublishError('UNKNOWN', `Threads báo lỗi máy chủ (${published.status}) khi đăng: chưa rõ bài đã lên hay chưa.`);
    }
    if (published.status >= 400) {
      throw this.apiError('NOT_SENT', published, token);
    }
    const externalPostId = typeof published.body.id === 'string' ? published.body.id : null;
    if (!externalPostId) {
      throw new ThreadsPublishError('UNKNOWN', 'Threads phản hồi không có mã bài: chưa rõ bài đã lên hay chưa.');
    }

    // 4) Lấy link bài (không bắt buộc: bài đã đăng, thiếu link không phải lỗi).
    const permalink = await this.fetchPermalink(externalPostId, token);
    return { externalPostId, permalink };
  }

  private async waitUntilReady(containerId: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const status = await this.call('GET', `/${encodeURIComponent(containerId)}`, { fields: 'status,error_message' }, token);
      if (status !== 'NO_RESPONSE' && status.status < 400) {
        const value = status.body.status;
        if (value === 'FINISHED') {
          return;
        }
        if (value === 'ERROR' || value === 'EXPIRED') {
          const detail = typeof status.body.error_message === 'string' ? `: ${status.body.error_message.slice(0, MAX_MESSAGE)}` : '';
          throw new ThreadsPublishError('NOT_SENT', `Threads không xử lý được nội dung (${String(value)})${detail}`, 'REJECTED');
        }
      } else if (status !== 'NO_RESPONSE' && status.status >= 400 && status.status < 500) {
        throw this.apiError('NOT_SENT', status, token);
      }
      if (attempt < this.pollAttempts - 1) {
        await this.sleep(this.pollDelayMs);
      }
    }
    throw new ThreadsPublishError('NOT_SENT', 'Threads chưa xử lý xong nội dung sau thời gian chờ. Chưa đăng gì; thử lại sau.');
  }

  private async fetchPermalink(externalPostId: string, token: string): Promise<string | null> {
    const result = await this.call('GET', `/${encodeURIComponent(externalPostId)}`, { fields: 'permalink' }, token);
    if (result === 'NO_RESPONSE' || result.status >= 400) {
      return null;
    }
    const link = result.body.permalink;
    return typeof link === 'string' && link.startsWith('https://') ? link.slice(0, 500) : null;
  }

  /** Gọi Threads. 'NO_RESPONSE' = lỗi mạng/hết thời gian/phản hồi không đọc được: người gọi quyết định NOT_SENT hay UNKNOWN. */
  private async call(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
    token: string,
  ): Promise<ApiResult | 'NO_RESPONSE'> {
    try {
      const search = new URLSearchParams(params);
      let url = `${this.baseUrl}${path}`;
      const init: FetchInit = { method, signal: AbortSignal.timeout(this.timeoutMs) };
      if (method === 'GET') {
        search.set('access_token', token);
        url += `?${search.toString()}`;
      } else {
        search.set('access_token', token);
        init.body = search;
      }
      const response = await this.fetchFn(url, init);
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await response.json();
        if (typeof parsed === 'object' && parsed !== null) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        if (response.status < 400) {
          return 'NO_RESPONSE';
        }
      }
      return { status: response.status, body };
    } catch {
      return 'NO_RESPONSE';
    }
  }

  private apiError(kind: 'NOT_SENT' | 'UNKNOWN', result: ApiResult, token: string): ThreadsPublishError {
    const error = (typeof result.body.error === 'object' && result.body.error !== null ? result.body.error : {}) as Record<string, unknown>;
    const code = typeof error.code === 'number' ? error.code : null;
    const raw = typeof error.message === 'string' ? error.message : 'Threads từ chối yêu cầu.';
    const message = raw.split(token).join('[token]').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').slice(0, MAX_MESSAGE);
    let reason: ThreadsErrorReason = 'OTHER';
    if (result.status === 401 || code === 190 || code === 102) {
      reason = 'AUTH';
    } else if (result.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
      reason = 'RATE_LIMIT';
    } else if (result.status === 400 || result.status === 403) {
      reason = code === 10 || code === 200 ? 'AUTH' : 'REJECTED';
    }
    const hint =
      reason === 'AUTH' ? ' Token có thể đã hết hạn hoặc thiếu quyền: hãy kết nối lại tài khoản.' : reason === 'RATE_LIMIT' ? ' Đã vượt hạn mức của Threads: thử lại sau.' : '';
    return new ThreadsPublishError(kind, `Threads (${result.status}${code !== null ? `/${code}` : ''}): ${message}.${hint}`, reason);
  }
}
