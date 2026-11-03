import { OfficialThreadsProvider } from './official-threads.provider';
import { ThreadsPublishError } from './threads-provider.types';

const TOKEN = 'THQW-secret-token-123';
const USER = '1789';

type Reply = { status?: number; body?: unknown; throws?: boolean; badJson?: boolean };
interface Call { method: string; url: string; body: string | null }

/** fetch giả: trả lần lượt các phản hồi đã định sẵn và ghi lại mọi yêu cầu. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? String(init.body) : null });
    const reply = replies.shift();
    if (!reply) {
      throw new Error('hết phản hồi giả');
    }
    if (reply.throws) {
      throw new Error(`network down ${TOKEN}`);
    }
    return {
      status: reply.status ?? 200,
      json: async () => {
        if (reply.badJson) {
          throw new Error('bad json');
        }
        return reply.body ?? {};
      },
    };
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function provider(replies: Reply[]) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const p = new OfficialThreadsProvider({
    fetchFn: f.fn,
    sleep: async (ms) => void sleeps.push(ms),
    pollAttempts: 3,
    pollDelayMs: 10,
    baseUrl: 'https://graph.example/v1.0',
  });
  return { p, calls: f.calls, sleeps };
}

const req = { idempotencyKey: 'k', accountExternalId: USER, accessToken: TOKEN, text: 'xin chào', hasMedia: false };
const err = (kind: 'NOT_SENT' | 'UNKNOWN', message: string, code?: number) => ({ status: kind === 'UNKNOWN' ? 500 : 400, body: { error: { message, code } } });

describe('OfficialThreadsProvider.publishText', () => {
  it('tạo container, chờ sẵn sàng, publish và lấy link', async () => {
    const { p, calls, sleeps } = provider([
      { body: { id: 'c1' } },
      { body: { status: 'IN_PROGRESS' } },
      { body: { status: 'FINISHED' } },
      { body: { id: 'post1' } },
      { body: { permalink: 'https://www.threads.net/@shop/post/AbC123' } },
    ]);
    const out = await p.publishText(req);
    expect(out).toEqual({ externalPostId: 'post1', permalink: 'https://www.threads.net/@shop/post/AbC123' });
    expect(sleeps).toEqual([10]);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`https://graph.example/v1.0/${USER}/threads`);
    expect(calls[0].body).toContain('media_type=TEXT');
    expect(calls[0].body).toContain('text=xin+ch%C3%A0o');
    expect(calls[0].body).toContain(`access_token=${TOKEN}`);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[3].url).toBe(`https://graph.example/v1.0/${USER}/threads_publish`);
    expect(calls[3].body).toContain('creation_id=c1');
  });

  it('thiếu link bài không phải lỗi: bài đã đăng', async () => {
    const { p } = provider([{ body: { id: 'c1' } }, { body: { status: 'FINISHED' } }, { body: { id: 'post1' } }, { throws: true }]);
    expect(await p.publishText(req)).toEqual({ externalPostId: 'post1', permalink: null });
  });

  it('lỗi ở bước tạo container luôn là NOT_SENT; token hết hạn được đánh dấu AUTH và không lộ token', async () => {
    const { p } = provider([{ status: 401, body: { error: { message: `Invalid OAuth access token ${TOKEN}.`, code: 190 } } }]);
    const e = await p.publishText(req).catch((x) => x as ThreadsPublishError);
    expect(e).toBeInstanceOf(ThreadsPublishError);
    expect(e).toMatchObject({ kind: 'NOT_SENT', reason: 'AUTH' });
    expect(String((e as Error).message)).not.toContain(TOKEN);
    expect(String((e as Error).message)).toContain('kết nối lại');
  });

  it('mất mạng khi tạo container: NOT_SENT; thông báo không chứa token', async () => {
    const { p } = provider([{ throws: true }]);
    const e = (await p.publishText(req).catch((x) => x)) as ThreadsPublishError;
    expect(e.kind).toBe('NOT_SENT');
    expect(e.message).not.toContain(TOKEN);
  });

  it('container báo ERROR: NOT_SENT/REJECTED và không publish', async () => {
    const { p, calls } = provider([{ body: { id: 'c1' } }, { body: { status: 'ERROR', error_message: 'Nội dung vi phạm' } }]);
    const e = (await p.publishText(req).catch((x) => x)) as ThreadsPublishError;
    expect(e).toMatchObject({ kind: 'NOT_SENT', reason: 'REJECTED' });
    expect(calls.some((c) => c.url.includes('threads_publish'))).toBe(false);
  });

  it('container chưa xong sau thời gian chờ: NOT_SENT, không publish', async () => {
    const { p, calls } = provider([{ body: { id: 'c1' } }, { body: { status: 'IN_PROGRESS' } }, { body: { status: 'IN_PROGRESS' } }, { body: { status: 'IN_PROGRESS' } }]);
    const e = (await p.publishText(req).catch((x) => x)) as ThreadsPublishError;
    expect(e.kind).toBe('NOT_SENT');
    expect(calls.some((c) => c.url.includes('threads_publish'))).toBe(false);
  });

  it('bước publish: mất mạng, 5xx hoặc phản hồi không có mã đều là UNKNOWN (có thể đã đăng)', async () => {
    for (const last of [{ throws: true }, { status: 500, body: {} }, { body: {} }, { badJson: true }] as Reply[]) {
      const { p } = provider([{ body: { id: 'c1' } }, { body: { status: 'FINISHED' } }, last]);
      const e = (await p.publishText(req).catch((x) => x)) as ThreadsPublishError;
      expect(e).toBeInstanceOf(ThreadsPublishError);
      expect(e.kind).toBe('UNKNOWN');
    }
  });

  it('bước publish: Threads từ chối rõ ràng (4xx) là NOT_SENT; vượt hạn mức được nhận ra', async () => {
    const { p } = provider([{ body: { id: 'c1' } }, { body: { status: 'FINISHED' } }, { status: 429, body: { error: { message: 'Too many', code: 4 } } }]);
    const e = (await p.publishText(req).catch((x) => x)) as ThreadsPublishError;
    expect(e).toMatchObject({ kind: 'NOT_SENT', reason: 'RATE_LIMIT' });
  });

  it('không có token: NOT_SENT/AUTH và không gọi mạng; media chưa được hỗ trợ', async () => {
    const { p, calls } = provider([]);
    const e = (await p.publishText({ ...req, accessToken: null }).catch((x) => x)) as ThreadsPublishError;
    expect(e).toMatchObject({ kind: 'NOT_SENT', reason: 'AUTH' });
    const m = (await p.publishText({ ...req, hasMedia: true }).catch((x) => x)) as ThreadsPublishError;
    expect(m.kind).toBe('NOT_SENT');
    expect(calls).toHaveLength(0);
  });
});

describe('OfficialThreadsProvider.publishReply', () => {
  it('gửi reply_to_id là mã bài chính', async () => {
    const { p, calls } = provider([{ body: { id: 'c2' } }, { body: { status: 'FINISHED' } }, { body: { id: 'reply1' } }, { body: {} }]);
    const out = await p.publishReply({ idempotencyKey: 'k', accountExternalId: USER, accessToken: TOKEN, replyToExternalId: 'post1', text: 'Link: https://s.shopee.vn/x' });
    expect(out.externalPostId).toBe('reply1');
    expect(calls[0].body).toContain('reply_to_id=post1');
  });
});

describe('OfficialThreadsProvider.fetchProfile', () => {
  it('trả id và tên tài khoản', async () => {
    const { p, calls } = provider([{ body: { id: USER, username: 'shop.demo' } }]);
    expect(await p.fetchProfile(TOKEN)).toEqual({ id: USER, username: 'shop.demo' });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/me?');
    expect(calls[0].url).toContain('fields=id%2Cusername');
  });

  it('token sai: ném NOT_SENT/AUTH; phản hồi thiếu dữ liệu bị từ chối', async () => {
    const bad = provider([err('NOT_SENT', 'Invalid token', 190)]);
    expect(await bad.p.fetchProfile(TOKEN).catch((x) => x)).toMatchObject({ kind: 'NOT_SENT', reason: 'AUTH' });
    const empty = provider([{ body: { id: USER } }]);
    expect(await empty.p.fetchProfile(TOKEN).catch((x) => x)).toBeInstanceOf(ThreadsPublishError);
  });
});
